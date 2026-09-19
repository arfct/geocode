/**
 * Serialise a single point (or a named set of points) to the three file
 * formats people actually pass around: GeoJSON, GPX and KML.
 *
 * All three functions are pure string builders so they can be unit tested
 * without a DOM or a browser.
 */

import type { LatLon } from './coordinates.js';

export interface NamedPoint extends LatLon {
	name?: string;
}

export type ExportFormat = 'geojson' | 'gpx' | 'kml';

export const EXPORT_FORMATS: {
	id: ExportFormat;
	label: string;
	extension: string;
	mime: string;
}[] = [
	{ id: 'geojson', label: 'GeoJSON', extension: 'geojson', mime: 'application/geo+json' },
	{ id: 'gpx', label: 'GPX', extension: 'gpx', mime: 'application/gpx+xml' },
	{ id: 'kml', label: 'KML', extension: 'kml', mime: 'application/vnd.google-earth.kml+xml' }
];

/** Trim trailing float noise but keep enough precision for ~1cm (7 places). */
function num(n: number): string {
	return String(Number(n.toFixed(7)));
}

function escapeXml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export function toGeoJson(points: NamedPoint[]): string {
	const features = points.map((p) => ({
		type: 'Feature',
		properties: p.name ? { name: p.name } : {},
		geometry: { type: 'Point', coordinates: [Number(num(p.lon)), Number(num(p.lat))] }
	}));
	return JSON.stringify({ type: 'FeatureCollection', features }, null, 2) + '\n';
}

export function toGpx(points: NamedPoint[]): string {
	const waypoints = points
		.map((p) => {
			const name = p.name ? `\n    <name>${escapeXml(p.name)}</name>` : '';
			return `  <wpt lat="${num(p.lat)}" lon="${num(p.lon)}">${name}\n  </wpt>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="geocode" xmlns="http://www.topografix.com/GPX/1/1">
${waypoints}
</gpx>
`;
}

export function toKml(points: NamedPoint[]): string {
	const placemarks = points
		.map((p) => {
			const name = p.name ? `\n      <name>${escapeXml(p.name)}</name>` : '';
			return `    <Placemark>${name}
      <Point>
        <coordinates>${num(p.lon)},${num(p.lat)},0</coordinates>
      </Point>
    </Placemark>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
${placemarks}
  </Document>
</kml>
`;
}

export function exportPoints(points: NamedPoint[], format: ExportFormat): string {
	switch (format) {
		case 'geojson':
			return toGeoJson(points);
		case 'gpx':
			return toGpx(points);
		case 'kml':
			return toKml(points);
	}
}
