/**
 * Parsers for the three interchange formats we preview on the map. Each one
 * boils a file down to a small `GeoFeature[]` — points and lines/polygons in
 * [lat, lon] order, ready to hand to Leaflet.
 *
 * The XML parsers take an already-parsed `Document` so they stay pure: the
 * browser hands over `new DOMParser().parseFromString(...)`, and the tests use
 * jsdom for the same thing.
 */

import type { LatLon } from './coordinates.js';

export type GeoFeature =
	| { type: 'point'; name?: string; position: LatLon }
	| { type: 'line'; name?: string; positions: LatLon[] }
	| { type: 'polygon'; name?: string; rings: LatLon[][] };

export type PreviewFormat = 'geojson' | 'gpx' | 'kml' | 'dxf';

export function detectFormat(filename: string, text: string): PreviewFormat | null {
	const ext = filename.toLowerCase().split('.').pop();
	if (ext === 'geojson' || ext === 'json') return 'geojson';
	if (ext === 'gpx') return 'gpx';
	if (ext === 'kml') return 'kml';
	if (ext === 'dxf') return 'dxf';

	const head = text.slice(0, 2000);
	if (/<gpx[\s>]/i.test(head)) return 'gpx';
	if (/<kml[\s>]/i.test(head)) return 'kml';
	if (/^\s*[{[]/.test(head)) return 'geojson';
	if (/^\s*0\s*\r?\n\s*SECTION/.test(head) || /\bENTITIES\b/.test(head)) return 'dxf';
	return null;
}

// ---------------------------------------------------------------------------
// GeoJSON

type Position = number[];

interface Geometry {
	type: string;
	coordinates?: unknown;
	geometries?: Geometry[];
}

function pos([lon, lat]: Position): LatLon {
	return { lat, lon };
}

function geometryToFeatures(geometry: Geometry | null, name?: string): GeoFeature[] {
	if (!geometry) return [];
	const c = geometry.coordinates;
	switch (geometry.type) {
		case 'Point':
			return [{ type: 'point', name, position: pos(c as Position) }];
		case 'MultiPoint':
			return (c as Position[]).map((p) => ({ type: 'point', name, position: pos(p) }));
		case 'LineString':
			return [{ type: 'line', name, positions: (c as Position[]).map(pos) }];
		case 'MultiLineString':
			return (c as Position[][]).map((l) => ({ type: 'line', name, positions: l.map(pos) }));
		case 'Polygon':
			return [{ type: 'polygon', name, rings: (c as Position[][]).map((r) => r.map(pos)) }];
		case 'MultiPolygon':
			return (c as Position[][][]).map((p) => ({
				type: 'polygon',
				name,
				rings: p.map((r) => r.map(pos))
			}));
		case 'GeometryCollection':
			return (geometry.geometries ?? []).flatMap((g) => geometryToFeatures(g, name));
		default:
			return [];
	}
}

export function parseGeoJson(text: string): GeoFeature[] {
	const json = JSON.parse(text) as Record<string, unknown>;
	const nameOf = (f: Record<string, unknown>) => {
		const props = f.properties as Record<string, unknown> | null | undefined;
		const n = props?.name ?? props?.title;
		return typeof n === 'string' ? n : undefined;
	};
	if (json.type === 'FeatureCollection') {
		return (json.features as Record<string, unknown>[]).flatMap((f) =>
			geometryToFeatures(f.geometry as Geometry | null, nameOf(f))
		);
	}
	if (json.type === 'Feature') {
		return geometryToFeatures(json.geometry as Geometry | null, nameOf(json));
	}
	return geometryToFeatures(json as unknown as Geometry);
}

// ---------------------------------------------------------------------------
// GPX

function childText(el: Element, tag: string): string | undefined {
	for (const child of Array.from(el.children)) {
		if (child.localName === tag) return child.textContent?.trim() || undefined;
	}
	return undefined;
}

function byLocalName(root: ParentNode, tag: string): Element[] {
	return Array.from(root.querySelectorAll('*')).filter((el) => el.localName === tag);
}

function gpxPoint(el: Element): LatLon {
	return { lat: Number(el.getAttribute('lat')), lon: Number(el.getAttribute('lon')) };
}

export function parseGpx(doc: Document): GeoFeature[] {
	const features: GeoFeature[] = [];
	for (const wpt of byLocalName(doc, 'wpt')) {
		features.push({ type: 'point', name: childText(wpt, 'name'), position: gpxPoint(wpt) });
	}
	for (const rte of byLocalName(doc, 'rte')) {
		const positions = byLocalName(rte, 'rtept').map(gpxPoint);
		if (positions.length) features.push({ type: 'line', name: childText(rte, 'name'), positions });
	}
	for (const trk of byLocalName(doc, 'trk')) {
		const name = childText(trk, 'name');
		for (const seg of byLocalName(trk, 'trkseg')) {
			const positions = byLocalName(seg, 'trkpt').map(gpxPoint);
			if (positions.length) features.push({ type: 'line', name, positions });
		}
	}
	return features;
}

// ---------------------------------------------------------------------------
// KML

function kmlCoordinates(text: string | undefined): LatLon[] {
	if (!text) return [];
	return text
		.trim()
		.split(/\s+/)
		.map((tuple) => tuple.split(',').map(Number))
		.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
		.map(([lon, lat]) => ({ lat, lon }));
}

function coordinatesIn(el: Element): string | undefined {
	return byLocalName(el, 'coordinates')[0]?.textContent ?? undefined;
}

function kmlGeometry(el: Element, name?: string): GeoFeature[] {
	switch (el.localName) {
		case 'Point': {
			const [position] = kmlCoordinates(coordinatesIn(el));
			return position ? [{ type: 'point', name, position }] : [];
		}
		case 'LineString':
		case 'LinearRing': {
			const positions = kmlCoordinates(coordinatesIn(el));
			return positions.length ? [{ type: 'line', name, positions }] : [];
		}
		case 'Polygon': {
			const rings = byLocalName(el, 'LinearRing')
				.map((ring) => kmlCoordinates(coordinatesIn(ring)))
				.filter((r) => r.length);
			return rings.length ? [{ type: 'polygon', name, rings }] : [];
		}
		case 'MultiGeometry':
			return Array.from(el.children).flatMap((child) => kmlGeometry(child, name));
		default:
			return [];
	}
}

export function parseKml(doc: Document): GeoFeature[] {
	return byLocalName(doc, 'Placemark').flatMap((placemark) => {
		const name = childText(placemark, 'name');
		return Array.from(placemark.children).flatMap((child) => kmlGeometry(child, name));
	});
}

// ---------------------------------------------------------------------------

export function featureBounds(features: GeoFeature[]): [LatLon, LatLon] | null {
	let minLat = Infinity;
	let minLon = Infinity;
	let maxLat = -Infinity;
	let maxLon = -Infinity;
	const extend = ({ lat, lon }: LatLon) => {
		minLat = Math.min(minLat, lat);
		maxLat = Math.max(maxLat, lat);
		minLon = Math.min(minLon, lon);
		maxLon = Math.max(maxLon, lon);
	};
	for (const f of features) {
		if (f.type === 'point') extend(f.position);
		else if (f.type === 'line') f.positions.forEach(extend);
		else f.rings.forEach((r) => r.forEach(extend));
	}
	if (!Number.isFinite(minLat)) return null;
	return [
		{ lat: minLat, lon: minLon },
		{ lat: maxLat, lon: maxLon }
	];
}
