<script lang="ts">
	import '@fontsource-variable/geist-mono';
	import 'leaflet/dist/leaflet.css';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
