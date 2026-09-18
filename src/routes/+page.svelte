<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import Map from '$lib/components/Map.svelte';
	import DxfViewer from '$lib/components/DxfViewer.svelte';
	import { formatDecimal, parseLatLon } from '$lib/geo/coordinates.js';
	import { EXPORT_FORMATS, exportPoints, type ExportFormat } from '$lib/geo/export.js';
	import { parseDxf, type DxfDrawing } from '$lib/geo/dxf.js';
	import type { GeocodeResponse, Place } from '$lib/geo/places.js';
	import {
		detectFormat,
		parseGeoJson,
		parseGpx,
		parseKml,
		type GeoFeature
	} from '$lib/geo/formats.js';

	type Tool = 'geocode' | 'export' | 'preview';
	const TOOLS: { id: Tool; label: string }[] = [
		{ id: 'geocode', label: 'geocode' },
		{ id: 'export', label: 'export' },
		{ id: 'preview', label: 'preview' }
	];

	let tool = $state<Tool | null>(null);

	function showTool(next: Tool | null) {
		tool = next;
		// Only the hash changes; the path is this page's own.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(tool ? `#${tool}` : location.pathname, {});
	}

	function toggleTool(next: Tool) {
		showTool(tool === next ? null : next);
	}

	onMount(() => {
		const hash = location.hash.slice(1) as Tool;
		if (TOOLS.some((t) => t.id === hash)) tool = hash;
	});

	// ------------------------------------------------------------------ geocode

	let query = $state('');
	let places = $state<Place[]>([]);
	let selected = $state<Place | null>(null);
	let geocodeStatus = $state<'idle' | 'loading' | 'empty' | 'error' | 'unconfigured'>('idle');

	async function geocode() {
		const q = query.trim();
		if (!q) return;
		geocodeStatus = 'loading';
		places = [];
		selected = null;
		try {
			const params = new URLSearchParams({ q });
			const response = await fetch(`${resolve('/api/geocode')}?${params}`);
			if (response.status === 503) {
				geocodeStatus = 'unconfigured';
				return;
			}
			if (!response.ok) throw new Error(String(response.status));
			const body = (await response.json()) as GeocodeResponse;
			places = body.places;
			geocodeStatus = places.length ? 'idle' : 'empty';
			if (places.length) selected = places[0];
		} catch {
			geocodeStatus = 'error';
		}
	}

	const copyFormats = $derived.by(() => {
		if (!selected) return [];
		const { lat, lon } = selected.position;
		const a = lat.toFixed(6);
		const b = lon.toFixed(6);
		return [
			{ label: 'decimal', text: `${a}, ${b}` },
			{ label: 'comma', text: `${a},${b}` },
			{ label: 'space', text: `${a} ${b}` }
		];
	});

	let copied = $state<string | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = text;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = null), 1200);
	}

	// ------------------------------------------------------------------- export

	let exportInput = $state('');
	let exportName = $state('');
	const exportPoint = $derived(parseLatLon(exportInput));

	function sendToExport() {
		if (!selected) return;
		exportInput = formatDecimal(selected.position);
		exportName = selected.name;
		showTool('export');
	}

	function download(format: ExportFormat) {
		if (!exportPoint) return;
		const spec = EXPORT_FORMATS.find((f) => f.id === format)!;
		const text = exportPoints([{ ...exportPoint, name: exportName.trim() || undefined }], format);
		const blob = new Blob([text], { type: spec.mime });
		const href = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = href;
		a.download = `${(exportName.trim() || 'point').replace(/[^\w-]+/g, '-').toLowerCase()}.${spec.extension}`;
		a.click();
		URL.revokeObjectURL(href);
	}

	// ------------------------------------------------------------------ preview

	interface Preview {
		filename: string;
		features: GeoFeature[];
		drawing: DxfDrawing | null;
	}

	let preview = $state<Preview | null>(null);
	let previewError = $state<string | null>(null);
	let dragOver = $state(false);
	let fileInput: HTMLInputElement;
	let dxfViewer = $state<DxfViewer>();

	async function loadFile(file: File) {
		previewError = null;
		const text = await file.text();
		const format = detectFormat(file.name, text);
		try {
			if (format === 'dxf') {
				const drawing = parseDxf(text);
				if (!drawing.paths.length) throw new Error('no drawable entities found');
				preview = { filename: file.name, features: [], drawing };
			} else if (format === 'geojson') {
				preview = { filename: file.name, features: parseGeoJson(text), drawing: null };
			} else if (format === 'gpx' || format === 'kml') {
				const doc = new DOMParser().parseFromString(text, 'application/xml');
				if (doc.querySelector('parsererror')) throw new Error('malformed xml');
				preview = {
					filename: file.name,
					features: format === 'gpx' ? parseGpx(doc) : parseKml(doc),
					drawing: null
				};
			} else {
				throw new Error('unrecognised file — try .dxf, .gpx, .kml or .geojson');
			}
			if (preview && !preview.drawing && !preview.features.length) {
				throw new Error('no geometry found');
			}
			showTool('preview');
		} catch (error) {
			preview = null;
			previewError = error instanceof Error ? error.message : 'could not read file';
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
		const file = event.dataTransfer?.files[0];
		if (file) void loadFile(file);
	}

	function onDragOver(event: DragEvent) {
		event.preventDefault();
		dragOver = true;
	}

	const mapMarker = $derived(tool === 'export' ? exportPoint : (selected?.position ?? null));
	const featureCount = $derived(preview?.features.length ?? 0);
	const pathCount = $derived(preview?.drawing?.paths.length ?? 0);
	const faceCount = $derived(preview?.drawing?.faces.length ?? 0);
</script>

<svelte:head>
	<title>geocode</title>
	<meta name="description" content="Small browser-side tools for geographic data." />
</svelte:head>

<svelte:window ondragover={onDragOver} ondragleave={() => (dragOver = false)} ondrop={onDrop} />

<main class:drag-over={dragOver}>
	<div class="stage">
		{#if preview?.drawing}
			<DxfViewer bind:this={dxfViewer} drawing={preview.drawing} />
		{:else}
			<Map marker={mapMarker} features={preview?.features ?? []} />
		{/if}
		<div class="vignette" aria-hidden="true"></div>
	</div>

	<section class="panel">
		<h1>geocode</h1>
		<p class="muted">small tools for geographic data</p>

		<nav>
			{#each TOOLS as t (t.id)}
				<button
					type="button"
					class="link"
					class:active={tool === t.id}
					onclick={() => toggleTool(t.id)}
				>
					{t.label}
				</button>
			{/each}
			<a href={resolve('/coordinates')}>coordinates</a>
		</nav>

		{#if tool === 'geocode'}
			<form
				class="tool"
				onsubmit={(e) => {
					e.preventDefault();
					void geocode();
				}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={query}
					placeholder="place name ⏎"
					autofocus
					autocomplete="off"
					spellcheck="false"
				/>
				{#if geocodeStatus === 'loading'}
					<p class="muted">searching…</p>
				{:else if geocodeStatus === 'empty'}
					<p class="muted">nothing found</p>
				{:else if geocodeStatus === 'error'}
					<p class="muted">lookup failed</p>
				{:else if geocodeStatus === 'unconfigured'}
					<p class="muted">geocoding is not configured on this server</p>
				{/if}

				{#if places.length > 1}
					<ul class="places">
						{#each places as place (place.address + place.name)}
							<li>
								<button
									type="button"
									class="link"
									class:active={place === selected}
									onclick={() => (selected = place)}
								>
									{place.name}<span class="muted"> · {place.address}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if selected}
					<p>{selected.name}<span class="muted"> · {selected.address}</span></p>
				{/if}

				{#if selected}
					<ul class="copy">
						{#each copyFormats as f (f.label)}
							<li>
								<span class="muted">{f.label}</span>
								<button type="button" class="link" onclick={() => copy(f.text)}>{f.text}</button>
								{#if copied === f.text}<span class="muted">copied</span>{/if}
							</li>
						{/each}
					</ul>
					<p><button type="button" class="link" onclick={sendToExport}>export →</button></p>
				{/if}
			</form>
		{:else if tool === 'export'}
			<div class="tool">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={exportInput}
					placeholder="lat, lng"
					autofocus
					autocomplete="off"
					spellcheck="false"
				/>
				<input
					type="text"
					bind:value={exportName}
					placeholder="name (optional)"
					autocomplete="off"
				/>
				{#if exportPoint}
					<ul class="copy">
						{#each EXPORT_FORMATS as f (f.id)}
							<li>
								<button type="button" class="link" onclick={() => download(f.id)}
									>↓ {f.label}</button
								>
							</li>
						{/each}
					</ul>
				{:else if exportInput.trim()}
					<p class="muted">not a coordinate pair yet</p>
				{:else}
					<p class="muted">decimal, dms or degrees-minutes</p>
				{/if}
			</div>
		{:else if tool === 'preview'}
			<div class="tool">
				{#if preview}
					<p>
						{preview.filename}
						<span class="muted">
							· {#if preview.drawing}{pathCount} paths{#if faceCount}
									· {faceCount} faces{/if}{:else}{featureCount}
								features{/if}
						</span>
					</p>
					{#if preview.drawing}
						<ul class="copy">
							<li>
								<span class="muted">rotate</span>
								<button type="button" class="link" onclick={() => dxfViewer?.rotateBy(-15)}
									>↺</button
								>
								<button type="button" class="link" onclick={() => dxfViewer?.rotateBy(15)}>↻</button
								>
							</li>
							<li>
								<span class="muted">zoom</span>
								<button type="button" class="link" onclick={() => dxfViewer?.zoomBy(1.25)}>+</button
								>
								<button type="button" class="link" onclick={() => dxfViewer?.zoomBy(0.8)}>−</button>
							</li>
							<li>
								<button type="button" class="link" onclick={() => dxfViewer?.reset()}>reset</button>
							</li>
						</ul>
						<p class="muted">drag to orbit · scroll to zoom · right-drag to pan</p>
					{/if}
					<p><button type="button" class="link" onclick={() => (preview = null)}>clear</button></p>
				{:else}
					<p class="muted">
						drop a .dxf, .gpx, .kml or .geojson file anywhere, or
						<button type="button" class="link" onclick={() => fileInput.click()}>choose one</button>
					</p>
				{/if}
				{#if previewError}
					<p class="muted">{previewError}</p>
				{/if}
			</div>
		{/if}
	</section>

	<input
		class="hidden"
		type="file"
		accept=".dxf,.gpx,.kml,.geojson,.json"
		bind:this={fileInput}
		onchange={(e) => {
			const file = (e.currentTarget as HTMLInputElement).files?.[0];
			if (file) void loadFile(file);
		}}
	/>

	<footer class="muted">
		<a href="https://www.openstreetmap.org/copyright">© openstreetmap</a>
	</footer>
</main>

<style>
	main {
		position: fixed;
		inset: 0;
		overflow: hidden;
		transition: background 0.2s ease;
	}

	main.drag-over {
		background: #111112;
	}

	.stage {
		position: absolute;
		left: 50%;
		top: 50%;
		width: min(72vmin, 640px);
		aspect-ratio: 1;
		translate: -50% -50%;
		border-radius: 50%;
		overflow: hidden;
		isolation: isolate;
	}

	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 500;
		background: radial-gradient(
			circle at center,
			transparent 38%,
			rgba(11, 11, 12, 0.55) 62%,
			var(--bg) 74%
		);
	}

	.vignette::before {
		content: '';
		position: absolute;
		inset: 0;
		backdrop-filter: blur(3px);
		-webkit-backdrop-filter: blur(3px);
		mask-image: radial-gradient(circle at center, transparent 40%, black 66%);
		-webkit-mask-image: radial-gradient(circle at center, transparent 40%, black 66%);
	}

	.panel {
		position: absolute;
		top: 2rem;
		left: 2rem;
		width: min(22rem, calc(100vw - 4rem));
		z-index: 1000;
	}

	h1 {
		font-size: 1rem;
		font-weight: 500;
		margin: 0;
		letter-spacing: 0.02em;
	}

	.panel p {
		margin: 0;
	}

	nav {
		display: flex;
		gap: 1.25rem;
		margin: 1.5rem 0 0;
	}

	.tool {
		margin-top: 1.5rem;
		display: grid;
		gap: 0.6rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.places li,
	.copy li {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
	}

	.places button {
		text-align: left;
		border-bottom-color: transparent;
	}

	.copy .muted:first-child {
		min-width: 4rem;
	}

	.hidden {
		display: none;
	}

	footer {
		position: absolute;
		right: 2rem;
		bottom: 1.5rem;
		font-size: 10px;
		z-index: 1000;
	}

	footer a {
		color: var(--muted);
		border-color: transparent;
	}

	@media (max-width: 640px) {
		.stage {
			top: auto;
			bottom: 3rem;
			translate: -50% 0;
			width: min(80vw, 80vh);
		}

		.panel {
			top: 1.25rem;
			left: 1.25rem;
			width: calc(100vw - 2.5rem);
		}

		footer {
			right: 1.25rem;
			bottom: 0.75rem;
		}
	}
</style>
