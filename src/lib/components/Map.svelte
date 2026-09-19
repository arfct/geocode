<script lang="ts">
	import { onMount } from 'svelte';
	import type * as Leaflet from 'leaflet';
	import type { LatLon } from '$lib/geo/coordinates.js';
	import { featureBounds, type GeoFeature } from '$lib/geo/formats.js';

	interface Props {
		/** A single highlighted point — the geocode / export result. */
		marker?: LatLon | null;
		/** Parsed features from a dropped file. */
		features?: GeoFeature[];
	}

	let { marker = null, features = [] }: Props = $props();

	let container: HTMLDivElement;
	let L: typeof Leaflet | undefined = $state();
	let map: Leaflet.Map | undefined;
	let markerLayer: Leaflet.LayerGroup | undefined;
	let featureLayer: Leaflet.LayerGroup | undefined;

	const STROKE = {
		color: '#e8e8e6',
		weight: 1.25,
		opacity: 0.9,
		fillColor: '#e8e8e6',
		fillOpacity: 0.08
	};

	onMount(() => {
		void setup();
		return () => map?.remove();
	});

	async function setup() {
		L = (await import('leaflet')).default;
		map = L.map(container, {
			zoomControl: false,
			attributionControl: false,
			worldCopyJump: true
		}).setView([37.7749, -122.4194], 11);
		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
		markerLayer = L.layerGroup().addTo(map);
		featureLayer = L.layerGroup().addTo(map);
	}

	$effect(() => {
		if (!L || !map || !markerLayer) return;
		markerLayer.clearLayers();
		if (marker) {
			L.circleMarker([marker.lat, marker.lon], { ...STROKE, radius: 5, fillOpacity: 1 }).addTo(
				markerLayer
			);
			L.circleMarker([marker.lat, marker.lon], {
				...STROKE,
				radius: 14,
				fillOpacity: 0,
				weight: 0.75
			}).addTo(markerLayer);
			map.flyTo([marker.lat, marker.lon], Math.max(map.getZoom(), 12), { duration: 0.8 });
		}
	});

	$effect(() => {
		if (!L || !map || !featureLayer) return;
		featureLayer.clearLayers();
		for (const f of features) {
			if (f.type === 'point') {
				L.circleMarker([f.position.lat, f.position.lon], {
					...STROKE,
					radius: 4,
					fillOpacity: 1
				}).addTo(featureLayer);
			} else if (f.type === 'line') {
				L.polyline(
					f.positions.map((p) => [p.lat, p.lon] as [number, number]),
					STROKE
				).addTo(featureLayer);
			} else {
				L.polygon(
					f.rings.map((r) => r.map((p) => [p.lat, p.lon] as [number, number])),
					STROKE
				).addTo(featureLayer);
			}
		}
		const bounds = featureBounds(features);
		if (bounds) {
			map.fitBounds(
				[
					[bounds[0].lat, bounds[0].lon],
					[bounds[1].lat, bounds[1].lon]
				],
				{ padding: [40, 40], maxZoom: 16 }
			);
		}
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		position: absolute;
		inset: 0;
		background: var(--bg);
	}

	/* Invert the light OSM tiles into a muted, near-monochrome dark map. Only the
	   tiles are filtered so the white overlay strokes stay white. */
	.map :global(.leaflet-tile-pane) {
		filter: grayscale(1) invert(1) brightness(0.62) contrast(0.85);
	}

	.map :global(.leaflet-container) {
		background: var(--bg);
		font-family: var(--mono);
	}
</style>
