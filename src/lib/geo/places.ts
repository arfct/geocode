/**
 * Shapes shared between the geocode API route and the client, plus the pure
 * mapping from a Google Places "Text Search (New)" response to our own
 * `Place`. Keeping the mapping here means the route handler is just fetch +
 * error handling.
 */

import type { LatLon } from './coordinates.js';

export interface Place {
	name: string;
	address: string;
	position: LatLon;
}

export interface GeocodeResponse {
	places: Place[];
}

/** The subset of the Places API response we ask for via the field mask. */
export interface PlacesTextSearchResponse {
	places?: {
		displayName?: { text?: string };
		formattedAddress?: string;
		location?: { latitude?: number; longitude?: number };
	}[];
}

export const PLACES_FIELD_MASK = 'places.displayName,places.formattedAddress,places.location';

export function placesFromTextSearch(response: PlacesTextSearchResponse): Place[] {
	return (response.places ?? []).flatMap((p) => {
		const lat = p.location?.latitude;
		const lon = p.location?.longitude;
		if (typeof lat !== 'number' || typeof lon !== 'number') return [];
		const address = p.formattedAddress ?? '';
		return [{ name: p.displayName?.text ?? address, address, position: { lat, lon } }];
	});
}
