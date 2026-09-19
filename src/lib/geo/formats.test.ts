// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { detectFormat, featureBounds, parseGeoJson, parseGpx, parseKml } from './formats.js';

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

describe('detectFormat', () => {
	it('trusts the extension first', () => {
		expect(detectFormat('walk.GPX', '')).toBe('gpx');
		expect(detectFormat('plan.dxf', '')).toBe('dxf');
		expect(detectFormat('x.json', '')).toBe('geojson');
	});

	it('sniffs content when the extension is unhelpful', () => {
		expect(detectFormat('data', '<?xml version="1.0"?><kml xmlns="x">')).toBe('kml');
		expect(detectFormat('data', '  0\nSECTION\n  2\nHEADER')).toBe('dxf');
		expect(detectFormat('data', '{"type":"Point"}')).toBe('geojson');
		expect(detectFormat('data.txt', 'hello')).toBeNull();
	});
});

describe('parseGeoJson', () => {
	it('flattens a FeatureCollection into lat/lon features', () => {
		const features = parseGeoJson(
			JSON.stringify({
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: { name: 'A' },
						geometry: { type: 'Point', coordinates: [10, 20] }
					},
					{
						type: 'Feature',
						properties: null,
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[0, 0],
									[1, 0],
									[1, 1],
									[0, 0]
								]
							]
						}
					}
				]
			})
		);
		expect(features).toEqual([
			{ type: 'point', name: 'A', position: { lat: 20, lon: 10 } },
			{
				type: 'polygon',
				name: undefined,
				rings: [
					[
						{ lat: 0, lon: 0 },
						{ lat: 0, lon: 1 },
						{ lat: 1, lon: 1 },
						{ lat: 0, lon: 0 }
					]
				]
			}
		]);
	});

	it('accepts a bare geometry', () => {
		expect(parseGeoJson('{"type":"LineString","coordinates":[[1,2],[3,4]]}')).toEqual([
			{
				type: 'line',
				name: undefined,
				positions: [
					{ lat: 2, lon: 1 },
					{ lat: 4, lon: 3 }
				]
			}
		]);
	});
});

describe('parseGpx', () => {
	it('reads waypoints, routes and track segments', () => {
		const doc = xml(`<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="1" lon="2"><name>Home</name></wpt>
  <rte><name>R</name><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>
  <trk><name>T</name>
    <trkseg><trkpt lat="3" lon="3"/><trkpt lat="4" lon="4"/></trkseg>
    <trkseg><trkpt lat="5" lon="5"/><trkpt lat="6" lon="6"/></trkseg>
  </trk>
</gpx>`);
		const features = parseGpx(doc);
		expect(features).toHaveLength(4);
		expect(features[0]).toEqual({ type: 'point', name: 'Home', position: { lat: 1, lon: 2 } });
		expect(features[1].name).toBe('R');
		expect(features[3]).toMatchObject({ type: 'line', name: 'T' });
	});
});

describe('parseKml', () => {
	it('reads placemarks with points, lines and polygons', () => {
		const doc = xml(`<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>P</name><Point><coordinates>10,20,0</coordinates></Point></Placemark>
  <Placemark><LineString><coordinates>
    0,0,0
    1,1,0
  </coordinates></LineString></Placemark>
  <Placemark><Polygon><outerBoundaryIs><LinearRing>
    <coordinates>0,0 1,0 1,1 0,0</coordinates>
  </LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`);
		const features = parseKml(doc);
		expect(features[0]).toEqual({ type: 'point', name: 'P', position: { lat: 20, lon: 10 } });
		expect(features[1]).toMatchObject({
			type: 'line',
			positions: [
				{ lat: 0, lon: 0 },
				{ lat: 1, lon: 1 }
			]
		});
		expect(features[2]).toMatchObject({ type: 'polygon' });
		expect((features[2] as { rings: unknown[][] }).rings[0]).toHaveLength(4);
	});
});

describe('featureBounds', () => {
	it('spans every coordinate of every feature', () => {
		const bounds = featureBounds([
			{ type: 'point', position: { lat: 5, lon: -5 } },
			{
				type: 'line',
				positions: [
					{ lat: -1, lon: 10 },
					{ lat: 2, lon: 3 }
				]
			}
		]);
		expect(bounds).toEqual([
			{ lat: -1, lon: -5 },
			{ lat: 5, lon: 10 }
		]);
	});

	it('is null for nothing', () => {
		expect(featureBounds([])).toBeNull();
	});
});
