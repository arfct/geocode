/**
 * Coordinate parsing and formatting.
 *
 * Latitude/longitude arrive from the wild in three shapes: decimal degrees
 * (`37.7749, -122.4194`), degrees-minutes-seconds (`37°46'29.6"N 122°25'9.8"W`),
 * and degrees-decimal-minutes (`37 46.494 N`). Everything here converts to and
 * from a plain decimal-degrees `LatLon`.
 */

export interface LatLon {
	lat: number;
	lon: number;
}

export type Hemisphere = 'N' | 'S' | 'E' | 'W';

export interface Dms {
	degrees: number;
	minutes: number;
	seconds: number;
	hemisphere: Hemisphere;
}

const DEGREES_PER_MINUTE = 1 / 60;
const DEGREES_PER_SECOND = 1 / 3600;

/** Matches a single signed number followed by an optional hemisphere letter. */
const COMPONENT = String.raw`(-?\d+(?:\.\d+)?)\s*(?:°|d|º)?\s*(?:(\d+(?:\.\d+)?)\s*(?:'|′|m)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|s)?)?)?\s*([NSEW])?`;
const PAIR = new RegExp(`^\\s*${COMPONENT}\\s*[,;/]?\\s*${COMPONENT}\\s*$`, 'i');

export function isValidLatLon({ lat, lon }: LatLon): boolean {
	return (
		Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
	);
}

/**
 * Parses one coordinate pair in decimal degrees, DMS, or degrees-decimal-minutes.
 * Returns null rather than throwing — callers are usually rendering as the user types.
 */
export function parseLatLon(input: string): LatLon | null {
	const match = PAIR.exec(input);
	if (!match) return null;

	const first = componentToDegrees(match[1], match[2], match[3], match[4]);
	const second = componentToDegrees(match[5], match[6], match[7], match[8]);
	if (first === null || second === null) return null;

	// Hemisphere letters win over position: "122W, 37N" means the same as "37N, 122W".
	const firstIsLon = /[EW]/i.test(match[4] ?? '');
	const result = firstIsLon
		? { lat: second.degrees, lon: first.degrees }
		: { lat: first.degrees, lon: second.degrees };

	return isValidLatLon(result) ? result : null;
}

function componentToDegrees(
	degreesText: string,
	minutesText: string | undefined,
	secondsText: string | undefined,
	hemisphereText: string | undefined
): { degrees: number } | null {
	const degrees = Number(degreesText);
	const minutes = minutesText === undefined ? 0 : Number(minutesText);
	const seconds = secondsText === undefined ? 0 : Number(secondsText);
	if (!Number.isFinite(degrees) || minutes >= 60 || seconds >= 60) return null;

	// A negative sign applies to the whole component, not just the degrees part.
	const sign = degreesText.trimStart().startsWith('-') ? -1 : 1;
	const magnitude = Math.abs(degrees) + minutes * DEGREES_PER_MINUTE + seconds * DEGREES_PER_SECOND;

	const hemisphere = hemisphereText?.toUpperCase();
	const hemisphereSign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1;

	return { degrees: magnitude * sign * hemisphereSign };
}

export function toDms(degrees: number, axis: 'lat' | 'lon'): Dms {
	const magnitude = Math.abs(degrees);
	const wholeDegrees = Math.floor(magnitude);
	const totalMinutes = (magnitude - wholeDegrees) * 60;
	const wholeMinutes = Math.floor(totalMinutes);
	const seconds = (totalMinutes - wholeMinutes) * 60;

	const hemisphere: Hemisphere =
		axis === 'lat' ? (degrees < 0 ? 'S' : 'N') : degrees < 0 ? 'W' : 'E';

	return { degrees: wholeDegrees, minutes: wholeMinutes, seconds, hemisphere };
}

export function formatDms(degrees: number, axis: 'lat' | 'lon'): string {
	const { degrees: d, minutes, seconds, hemisphere } = toDms(degrees, axis);
	return `${d}°${String(minutes).padStart(2, '0')}'${seconds.toFixed(2).padStart(5, '0')}"${hemisphere}`;
}

export function formatDecimal({ lat, lon }: LatLon, places = 6): string {
	return `${lat.toFixed(places)}, ${lon.toFixed(places)}`;
}

export function formatDecimalMinutes(degrees: number, axis: 'lat' | 'lon'): string {
	const { degrees: d, minutes, seconds, hemisphere } = toDms(degrees, axis);
	return `${d}° ${(minutes + seconds / 60).toFixed(4)}' ${hemisphere}`;
}
