/**
 * GET /api/geocode?q=<place name>
 *
 * Forwards a text search to the Google Places API (New) so the API key never
 * reaches the browser. Responds with `{ places: Place[] }`.
 *
 * Locally the key comes from `.env` (`GOOGLE_MAPS_API_KEY=...`); on Cloudflare
 * set it with `wrangler secret put GOOGLE_MAPS_API_KEY`.
 */

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	PLACES_FIELD_MASK,
	placesFromTextSearch,
	type GeocodeResponse,
	type PlacesTextSearchResponse
} from '$lib/geo/places.js';
import type { RequestHandler } from './$types.js';

const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 5;

export const GET: RequestHandler = async ({ url, fetch }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query) error(400, 'missing q');
	if (query.length > MAX_QUERY_LENGTH) error(400, 'query too long');

	const apiKey = env.GOOGLE_MAPS_API_KEY;
	if (!apiKey) error(503, 'geocoding is not configured');

	const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask': PLACES_FIELD_MASK
		},
		body: JSON.stringify({ textQuery: query, pageSize: MAX_RESULTS })
	});

	if (!upstream.ok) {
		console.error('places search failed', upstream.status, await upstream.text());
		error(502, 'geocoding failed');
	}

	const body = (await upstream.json()) as PlacesTextSearchResponse;
	const response: GeocodeResponse = { places: placesFromTextSearch(body).slice(0, MAX_RESULTS) };
	return json(response, { headers: { 'Cache-Control': 'private, max-age=300' } });
};
