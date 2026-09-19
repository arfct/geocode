import { describe, expect, it } from 'vitest';
import { toGeoJson, toGpx, toKml } from './export.js';

const sf = { lat: 37.7749295, lon: -122.4194155, name: 'San <Francisco>' };

describe('toGeoJson', () => {
	it('emits a FeatureCollection with lon,lat ordering', () => {
		const parsed = JSON.parse(toGeoJson([sf]));
		expect(parsed.type).toBe('FeatureCollection');
		expect(parsed.features[0].geometry.coordinates).toEqual([-122.4194155, 37.7749295]);
		expect(parsed.features[0].properties.name).toBe('San <Francisco>');
	});

	it('omits the name property when there is no name', () => {
		const parsed = JSON.parse(toGeoJson([{ lat: 1, lon: 2 }]));
		expect(parsed.features[0].properties).toEqual({});
	});
});

describe('toGpx', () => {
	it('writes waypoints with lat/lon attributes and escapes names', () => {
		const gpx = toGpx([sf]);
		expect(gpx).toContain('<wpt lat="37.7749295" lon="-122.4194155">');
		expect(gpx).toContain('<name>San &lt;Francisco&gt;</name>');
		expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
	});
});

describe('toKml', () => {
	it('writes lon,lat,alt coordinate triples', () => {
		const kml = toKml([sf]);
		expect(kml).toContain('<coordinates>-122.4194155,37.7749295,0</coordinates>');
		expect(kml).toContain('<name>San &lt;Francisco&gt;</name>');
	});

	it('trims float noise', () => {
		expect(toKml([{ lat: 0.1 + 0.2, lon: 1 }])).toContain('<coordinates>1,0.3,0</coordinates>');
	});
});
