import { describe, expect, it } from 'vitest';
import {
	formatDecimalMinutes,
	formatDms,
	isValidLatLon,
	parseLatLon,
	toDms
} from './coordinates.js';

describe('parseLatLon', () => {
	it('parses decimal degrees', () => {
		expect(parseLatLon('37.7749, -122.4194')).toEqual({ lat: 37.7749, lon: -122.4194 });
	});

	it('parses decimal degrees without a comma', () => {
		expect(parseLatLon('37.7749 -122.4194')).toEqual({ lat: 37.7749, lon: -122.4194 });
	});

	it('parses degrees, minutes, seconds', () => {
		const parsed = parseLatLon(`37°46'29.64"N 122°25'9.84"W`);
		expect(parsed?.lat).toBeCloseTo(37.7749, 6);
		expect(parsed?.lon).toBeCloseTo(-122.4194, 6);
	});

	it('parses degrees and decimal minutes', () => {
		const parsed = parseLatLon(`37 46.494 N, 122 25.164 W`);
		expect(parsed?.lat).toBeCloseTo(37.7749, 5);
		expect(parsed?.lon).toBeCloseTo(-122.4194, 5);
	});

	it('honours hemisphere letters over position', () => {
		expect(parseLatLon('122.4194W, 37.7749N')).toEqual({ lat: 37.7749, lon: -122.4194 });
	});

	it('rejects out-of-range values', () => {
		expect(parseLatLon('91, 0')).toBeNull();
		expect(parseLatLon('0, 181')).toBeNull();
	});

	it('rejects minutes and seconds at or above 60', () => {
		expect(parseLatLon(`37°60'00"N 122°00'00"W`)).toBeNull();
		expect(parseLatLon(`37°00'60"N 122°00'00"W`)).toBeNull();
	});

	it('returns null for text that is not a coordinate', () => {
		expect(parseLatLon('San Francisco')).toBeNull();
		expect(parseLatLon('')).toBeNull();
	});
});

describe('toDms', () => {
	it('splits a positive latitude', () => {
		const dms = toDms(37.7749, 'lat');
		expect(dms.degrees).toBe(37);
		expect(dms.minutes).toBe(46);
		expect(dms.seconds).toBeCloseTo(29.64, 2);
		expect(dms.hemisphere).toBe('N');
	});

	it('reports the western hemisphere for a negative longitude', () => {
		expect(toDms(-122.4194, 'lon').hemisphere).toBe('W');
	});
});

describe('formatting', () => {
	it('formats DMS with padded minutes and seconds', () => {
		expect(formatDms(37.7749, 'lat')).toBe(`37°46'29.64"N`);
		expect(formatDms(0.001, 'lon')).toBe(`0°00'03.60"E`);
	});

	it('formats degrees and decimal minutes', () => {
		expect(formatDecimalMinutes(-122.4194, 'lon')).toBe(`122° 25.1640' W`);
	});

	it('round-trips through DMS text', () => {
		const original = { lat: 51.5074, lon: -0.1278 };
		const parsed = parseLatLon(
			`${formatDms(original.lat, 'lat')} ${formatDms(original.lon, 'lon')}`
		);
		expect(parsed?.lat).toBeCloseTo(original.lat, 4);
		expect(parsed?.lon).toBeCloseTo(original.lon, 4);
	});
});

describe('isValidLatLon', () => {
	it('accepts the poles and the antimeridian', () => {
		expect(isValidLatLon({ lat: 90, lon: 180 })).toBe(true);
		expect(isValidLatLon({ lat: -90, lon: -180 })).toBe(true);
	});

	it('rejects NaN', () => {
		expect(isValidLatLon({ lat: Number.NaN, lon: 0 })).toBe(false);
	});
});
