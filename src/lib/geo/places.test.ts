import { describe, expect, it } from 'vitest';
import { placesFromTextSearch } from './places.js';

describe('placesFromTextSearch', () => {
	it('maps display name, address and location', () => {
		const places = placesFromTextSearch({
			places: [
				{
					displayName: { text: 'Tokyo Station' },
					formattedAddress: '1 Chome Marunouchi, Chiyoda City, Tokyo',
					location: { latitude: 35.681, longitude: 139.767 }
				}
			]
		});
		expect(places).toEqual([
			{
				name: 'Tokyo Station',
				address: '1 Chome Marunouchi, Chiyoda City, Tokyo',
				position: { lat: 35.681, lon: 139.767 }
			}
		]);
	});

	it('drops results without a location and falls back to the address as a name', () => {
		const places = placesFromTextSearch({
			places: [
				{ displayName: { text: 'Nowhere' } },
				{ formattedAddress: 'Somewhere', location: { latitude: 1, longitude: 2 } }
			]
		});
		expect(places).toEqual([
			{ name: 'Somewhere', address: 'Somewhere', position: { lat: 1, lon: 2 } }
		]);
	});

	it('handles an empty response', () => {
		expect(placesFromTextSearch({})).toEqual([]);
	});
});
