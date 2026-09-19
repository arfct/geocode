<script lang="ts">
	import { onMount } from 'svelte';
	import type * as Three from 'three';
	import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { isThreeDimensional, type DxfDrawing } from '$lib/geo/dxf.js';

	interface Props {
		drawing: DxfDrawing;
	}

	let { drawing }: Props = $props();

	let wrap: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let THREE: typeof Three | undefined;
	let renderer: Three.WebGLRenderer | undefined;
	let camera: Three.PerspectiveCamera | undefined;
	let controls: OrbitControls | undefined;
	let scene: Three.Scene | undefined;
	let model: Three.Group | undefined;
	let radius = 1;
	let failure = $state<string | null>(null);

	const LINE_COLOUR = 0xe8e8e6;
	const FACE_COLOUR = 0x8a8a88;

	onMount(() => {
		let disposed = false;
		void (async () => {
			let three: typeof Three;
			let OrbitControls: typeof import('three/addons/controls/OrbitControls.js').OrbitControls;
			try {
				[three, { OrbitControls }] = await Promise.all([
					import('three'),
					import('three/addons/controls/OrbitControls.js')
				]);
			} catch (error) {
				failure = error instanceof Error ? error.message : 'could not load the 3D renderer';
				return;
			}
			if (disposed) return;
			THREE = three;

			scene = new THREE.Scene();
			camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1e6);
			camera.up.set(0, 0, 1); // DXF is Z-up.

			// Soft sky/ground fill plus one key light so each wall of a building
			// gets its own grey tone under flat shading.
			scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.9));
			const key = new THREE.DirectionalLight(0xffffff, 1.4);
			key.position.set(0.6, -0.8, 1);
			scene.add(key);
			const rim = new THREE.DirectionalLight(0xffffff, 0.4);
			rim.position.set(-0.8, 0.5, 0.3);
			scene.add(rim);

			renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setClearColor(0x000000, 0);

			controls = new OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true;
			controls.dampingFactor = 0.12;
			controls.addEventListener('change', render);

			resize();
			build();
			animate();
		})();

		const observer = new ResizeObserver(resize);
		observer.observe(wrap);

		return () => {
			disposed = true;
			observer.disconnect();
			controls?.dispose();
			disposeModel();
			renderer?.dispose();
		};
	});

	$effect(() => {
		void drawing;
		if (THREE) build();
	});

	let frame = 0;
	function animate() {
		frame = requestAnimationFrame(animate);
		// Damping keeps moving after the pointer stops; update() returns true while it does.
		if (controls?.update()) render();
	}

	$effect(() => () => cancelAnimationFrame(frame));

	function render() {
		if (renderer && scene && camera) renderer.render(scene, camera);
	}

	function resize() {
		if (!renderer || !camera) return;
		const w = wrap.clientWidth;
		const h = wrap.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		render();
	}

	function disposeModel() {
		if (!model || !scene) return;
		scene.remove(model);
		model.traverse((obj) => {
			const o = obj as Three.Mesh;
			o.geometry?.dispose();
			const material = o.material as Three.Material | Three.Material[] | undefined;
			if (Array.isArray(material)) material.forEach((m) => m.dispose());
			else material?.dispose();
		});
		model = undefined;
	}

	function build() {
		if (!THREE || !scene) return;
		disposeModel();
		model = new THREE.Group();

		const b = drawing.bounds;
		const centre = b
			? new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
			: new THREE.Vector3();
		radius = b
			? Math.max(1e-6, Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2)
			: 1;

		// Lines: one LineSegments for every path so it is a single draw call.
		const linePositions: number[] = [];
		const pointPositions: number[] = [];
		for (const path of drawing.paths) {
			const pts = path.points;
			if (pts.length === 1) {
				pointPositions.push(pts[0].x - centre.x, pts[0].y - centre.y, pts[0].z - centre.z);
				continue;
			}
			const count = path.closed ? pts.length : pts.length - 1;
			for (let i = 0; i < count; i++) {
				const a = pts[i];
				const c = pts[(i + 1) % pts.length];
				linePositions.push(a.x - centre.x, a.y - centre.y, a.z - centre.z);
				linePositions.push(c.x - centre.x, c.y - centre.y, c.z - centre.z);
			}
		}

		// Faces: triangulated and shaded as solid grey surfaces.
		const facePositions: number[] = [];
		for (const face of drawing.faces) {
			const p = face.points;
			// Fan triangulation; DXF faces are planar and (nearly always) convex.
			for (let i = 1; i + 1 < p.length; i++) {
				for (const v of [p[0], p[i], p[i + 1]]) {
					facePositions.push(v.x - centre.x, v.y - centre.y, v.z - centre.z);
				}
			}
		}

		if (linePositions.length) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
			model.add(
				new THREE.LineSegments(
					geometry,
					new THREE.LineBasicMaterial({ color: LINE_COLOUR, transparent: true, opacity: 0.9 })
				)
			);
		}
		if (pointPositions.length) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
			model.add(
				new THREE.Points(
					geometry,
					new THREE.PointsMaterial({ color: LINE_COLOUR, size: 4, sizeAttenuation: false })
				)
			);
		}
		if (facePositions.length) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
			geometry.computeVertexNormals();
			model.add(
				new THREE.Mesh(
					geometry,
					new THREE.MeshLambertMaterial({
						color: FACE_COLOUR,
						side: THREE.DoubleSide,
						flatShading: true
					})
				)
			);
		}

		scene.add(model);
		reset();
	}

	/** Frames the whole drawing: straight down for flat drawings, an isometric-ish angle for 3D. */
	export function reset() {
		if (!camera || !controls) return;
		const distance = radius / Math.sin((camera.fov * Math.PI) / 360) / 0.85;
		if (isThreeDimensional(drawing)) {
			camera.position.set(distance * 0.62, -distance * 0.62, distance * 0.48);
		} else {
			camera.position.set(0, -1e-4 * distance, distance);
		}
		camera.near = distance / 1000;
		camera.far = distance * 100;
		camera.updateProjectionMatrix();
		controls.target.set(0, 0, 0);
		controls.update();
		render();
	}

	/** Orbits the camera around the vertical (Z) axis. */
	export function rotateBy(degrees: number) {
		if (!camera || !controls) return;
		camera.position.applyAxisAngle(new THREE!.Vector3(0, 0, 1), (degrees * Math.PI) / 180);
		controls.update();
		render();
	}

	/** Moves the camera towards (factor > 1) or away from (factor < 1) the target. */
	export function zoomBy(factor: number) {
		if (!camera || !controls) return;
		const offset = camera.position.clone().sub(controls.target).divideScalar(factor);
		camera.position.copy(controls.target).add(offset);
		controls.update();
		render();
	}
</script>

<div class="wrap" bind:this={wrap}>
	<canvas bind:this={canvas}></canvas>
	{#if failure}
		<p class="failure">{failure}</p>
	{/if}
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		background: var(--bg);
		cursor: grab;
		touch-action: none;
	}

	.wrap:active {
		cursor: grabbing;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.failure {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		padding: 2rem;
		text-align: center;
		color: var(--muted);
	}
</style>
