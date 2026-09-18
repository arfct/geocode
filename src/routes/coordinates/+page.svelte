<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		formatDecimal,
		formatDecimalMinutes,
		formatDms,
		parseLatLon
	} from '$lib/geo/coordinates.js';

	const examples = [
		'37.7749, -122.4194',
		`51°28'40.1"N 0°00'05.3"W`,
		'35 41.028 N, 139 46.212 E',
		'-33.8688 151.2093'
	];

	let input = $state(examples[0]);
	let parsed = $derived(parseLatLon(input));
</script>

<svelte:head>
	<title>Coordinate converter — geocode</title>
	<meta
		name="description"
		content="Convert latitude and longitude between decimal degrees, DMS, and degrees-decimal-minutes."
	/>
</svelte:head>

<div class="page">
	<p class="masthead">
		<a href={resolve('/')}>geocode</a> <span class="muted">/ coordinates</span>
	</p>
	<h1>Coordinate converter</h1>
	<p class="lede">
		Paste a latitude and longitude in any common notation. Hemisphere letters are honoured over
		ordering, so <code>122W, 37N</code> reads the same as <code>37N, 122W</code>.
	</p>

	<label for="coordinates">Coordinates</label>
	<input
		id="coordinates"
		type="text"
		bind:value={input}
		spellcheck="false"
		autocomplete="off"
		placeholder="37.7749, -122.4194"
	/>

	<div class="examples">
		{#each examples as example (example)}
			<button type="button" onclick={() => (input = example)}>{example}</button>
		{/each}
	</div>

	{#if parsed}
		<dl class="results">
			<div>
				<dt>Decimal degrees</dt>
				<dd>{formatDecimal(parsed)}</dd>
			</div>
			<div>
				<dt>Degrees, minutes, seconds</dt>
				<dd>{formatDms(parsed.lat, 'lat')} {formatDms(parsed.lon, 'lon')}</dd>
			</div>
			<div>
				<dt>Degrees decimal minutes</dt>
				<dd>{formatDecimalMinutes(parsed.lat, 'lat')} {formatDecimalMinutes(parsed.lon, 'lon')}</dd>
			</div>
			<div>
				<dt>GeoJSON position</dt>
				<dd>[{parsed.lon}, {parsed.lat}]</dd>
			</div>
		</dl>
	{:else if input.trim()}
		<p class="hint">Not a coordinate pair yet — keep typing, or pick an example above.</p>
	{:else}
		<p class="hint">Enter a coordinate pair to convert it.</p>
	{/if}
</div>
