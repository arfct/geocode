/**
 * A deliberately small DXF reader. It walks the ENTITIES section (expanding
 * block INSERTs from the BLOCKS section) and turns the common primitives into
 * two kinds of geometry a viewer can draw directly:
 *
 *   - `paths`: 3D polylines (LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE,
 *     SPLINE control polygons, POINT)
 *   - `faces`: planar polygons (3DFACE, polyface meshes, polygon meshes, MESH)
 *
 * ACIS solids (3DSOLID, REGION, BODY), hatches, text and dimensions are
 * skipped rather than approximated. MESH subdivision levels are ignored: the
 * control cage is drawn as-is.
 *
 * DXF is a stream of (group code, value) pairs on alternating lines; each
 * entity starts at code 0. See the AutoCAD DXF reference for the codes used.
 */

export interface Point3 {
	x: number;
	y: number;
	z: number;
}

export interface DxfPath {
	layer: string;
	points: Point3[];
	closed: boolean;
}

export interface DxfFace {
	layer: string;
	/** Three or more corners, in order around the face. */
	points: Point3[];
}

export interface DxfBounds {
	min: Point3;
	max: Point3;
}

export interface DxfDrawing {
	paths: DxfPath[];
	faces: DxfFace[];
	bounds: DxfBounds | null;
}

interface Pair {
	code: number;
	value: string;
}

type Entity = Pair[];

interface Block {
	base: Point3;
	entities: Entity[];
}

/** Maps a point from block space into drawing space. */
type Transform = (p: Point3) => Point3;

const ARC_SEGMENT_DEGREES = 6;
const MAX_INSERT_DEPTH = 8;

const IDENTITY: Transform = (p) => p;

/**
 * The transform an INSERT applies to its block: subtract the block base point,
 * scale, rotate about Z, translate to the insertion point.
 */
function insertTransform(
	origin: Point3,
	scale: Point3,
	rotation: number,
	translate: Point3
): Transform {
	const c = Math.cos(rotation);
	const s = Math.sin(rotation);
	return (p) => {
		const x = (p.x - origin.x) * scale.x;
		const y = (p.y - origin.y) * scale.y;
		const z = (p.z - origin.z) * scale.z;
		return { x: x * c - y * s + translate.x, y: x * s + y * c + translate.y, z: z + translate.z };
	};
}

/** Returns a transform equivalent to applying `inner` then `outer`. */
function compose(outer: Transform, inner: Transform): Transform {
	return (p) => outer(inner(p));
}

// ---------------------------------------------------------------------------
// Tokenising and sectioning

function tokenize(text: string): Pair[] {
	const lines = text.split(/\r\n|\r|\n/);
	const pairs: Pair[] = [];
	for (let i = 0; i + 1 < lines.length; i += 2) {
		const code = Number(lines[i].trim());
		if (!Number.isFinite(code)) continue;
		pairs.push({ code, value: lines[i + 1].trim() });
	}
	return pairs;
}

/** Groups the pairs following each `0` code into entities, per section. */
function sections(pairs: Pair[]): Map<string, Entity[]> {
	const out = new Map<string, Entity[]>();
	let current: Entity[] | null = null;
	let entity: Entity | null = null;

	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];
		if (pair.code === 0 && pair.value === 'SECTION') {
			const name = pairs[i + 1]?.code === 2 ? pairs[i + 1].value : '';
			current = [];
			out.set(name, current);
			entity = null;
			i++;
			continue;
		}
		if (pair.code === 0 && pair.value === 'ENDSEC') {
			current = null;
			entity = null;
			continue;
		}
		if (!current) continue;
		if (pair.code === 0) {
			entity = [pair];
			current.push(entity);
		} else {
			entity?.push(pair);
		}
	}
	return out;
}

function blocks(blockEntities: Entity[] | undefined): Map<string, Block> {
	const out = new Map<string, Block>();
	let block: Block | null = null;
	for (const entity of blockEntities ?? []) {
		const kind = entity[0].value;
		if (kind === 'BLOCK') {
			block = {
				base: { x: num(entity, 10), y: num(entity, 20), z: num(entity, 30) },
				entities: []
			};
			out.set(firstValue(entity, 2) ?? '', block);
		} else if (kind === 'ENDBLK') {
			block = null;
		} else {
			block?.entities.push(entity);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Small helpers

function firstValue(entity: Entity, code: number): string | undefined {
	return entity.find((p) => p.code === code)?.value;
}

function num(entity: Entity, code: number, fallback = 0): number {
	const v = firstValue(entity, code);
	return v === undefined ? fallback : Number(v);
}

function degreesToRadians(d: number): number {
	return (d * Math.PI) / 180;
}

/**
 * Collects the point sequence given by repeated (10, 20[, 30]) triples, plus
 * a parallel array of any per-vertex code (bulge 42 for polylines).
 */
function vertexList(entity: Entity, extraCode?: number): { point: Point3; extra: number }[] {
	const list: { point: Point3; extra: number }[] = [];
	for (const pair of entity) {
		if (pair.code === 10) list.push({ point: { x: Number(pair.value), y: 0, z: 0 }, extra: 0 });
		else if (!list.length) continue;
		else if (pair.code === 20) list[list.length - 1].point.y = Number(pair.value);
		else if (pair.code === 30) list[list.length - 1].point.z = Number(pair.value);
		else if (pair.code === extraCode) list[list.length - 1].extra = Number(pair.value);
	}
	return list;
}

function arcPoints(
	cx: number,
	cy: number,
	z: number,
	r: number,
	startDeg: number,
	endDeg: number
): Point3[] {
	let sweep = endDeg - startDeg;
	while (sweep <= 0) sweep += 360;
	const steps = Math.max(2, Math.ceil(sweep / ARC_SEGMENT_DEGREES));
	const points: Point3[] = [];
	for (let i = 0; i <= steps; i++) {
		const a = degreesToRadians(startDeg + (sweep * i) / steps);
		points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z });
	}
	return points;
}

/**
 * Expands a polyline vertex with a bulge (tangent of a quarter of the included
 * angle) into the arc points between it and the next vertex.
 */
function bulgeArc(from: Point3, to: Point3, bulge: number): Point3[] {
	const theta = 4 * Math.atan(bulge);
	const chord = Math.hypot(to.x - from.x, to.y - from.y);
	if (chord === 0 || theta === 0) return [];
	const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
	const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
	const d = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
	const sign = bulge < 0 ? -1 : 1;
	const nx = (-(to.y - from.y) / chord) * sign;
	const ny = ((to.x - from.x) / chord) * sign;
	// The centre sits on the side opposite to the bulge for large arcs.
	const centre =
		Math.abs(theta) > Math.PI
			? { x: mid.x - nx * d, y: mid.y - ny * d }
			: { x: mid.x + nx * d, y: mid.y + ny * d };
	const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x);
	const steps = Math.max(2, Math.ceil(Math.abs(theta) / degreesToRadians(ARC_SEGMENT_DEGREES)));
	const points: Point3[] = [];
	for (let i = 1; i < steps; i++) {
		const a = startAngle + (theta * i) / steps;
		points.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a), z: from.z });
	}
	return points;
}

function withBulges(vertices: { point: Point3; extra: number }[], closed: boolean): Point3[] {
	const out: Point3[] = [];
	for (let i = 0; i < vertices.length; i++) {
		const v = vertices[i];
		out.push(v.point);
		const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
		if (next && v.extra) out.push(...bulgeArc(v.point, next.point, v.extra));
	}
	return out;
}

// ---------------------------------------------------------------------------
// POLYLINE variants (needs the VERTEX entities that follow it)

const POLYLINE_CLOSED = 1;
const POLYLINE_3D = 8;
const POLYLINE_POLYGON_MESH = 16;
const POLYLINE_POLYFACE = 64;
const VERTEX_FACE_RECORD = 128;
const VERTEX_POLYFACE_MESH = 64;

/** Polyface vertices are flagged 192 (mesh + face record); pure face records are 128. */
function isFaceRecord(vertex: Entity): boolean {
	const flags = num(vertex, 70);
	return (flags & VERTEX_FACE_RECORD) !== 0 && (flags & VERTEX_POLYFACE_MESH) === 0;
}

function polyline(
	header: Entity,
	vertices: Entity[]
): { paths: Point3[][]; faces: Point3[][]; closed: boolean } {
	const flags = num(header, 70);
	const closed = (flags & POLYLINE_CLOSED) !== 0;
	const point = (v: Entity): Point3 => ({ x: num(v, 10), y: num(v, 20), z: num(v, 30) });

	if (flags & POLYLINE_POLYFACE) {
		const mesh = vertices.filter((v) => !isFaceRecord(v)).map(point);
		const faces: Point3[][] = [];
		for (const v of vertices) {
			if (!isFaceRecord(v)) continue;
			const corners = [71, 72, 73, 74]
				.map((code) => Math.abs(num(v, code)))
				.filter((i) => i > 0 && i <= mesh.length)
				.map((i) => mesh[i - 1]);
			if (corners.length >= 3) faces.push(corners);
		}
		return { paths: [], faces, closed };
	}

	if (flags & POLYLINE_POLYGON_MESH) {
		const m = num(header, 71);
		const n = num(header, 72);
		const grid = vertices.map(point);
		const faces: Point3[][] = [];
		const closedM = (flags & 1) !== 0;
		const closedN = (flags & 32) !== 0;
		const at = (i: number, j: number) => grid[(i % m) * n + (j % n)];
		for (let i = 0; i < (closedM ? m : m - 1); i++) {
			for (let j = 0; j < (closedN ? n : n - 1); j++) {
				const corners = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
				if (corners.every(Boolean)) faces.push(corners);
			}
		}
		return { paths: [], faces, closed };
	}

	if (flags & POLYLINE_3D) {
		return { paths: [vertices.map(point)], faces: [], closed };
	}

	const elevation = num(header, 30);
	const list = vertices.map((v) => ({
		point: { x: num(v, 10), y: num(v, 20), z: num(v, 30, elevation) },
		extra: num(v, 42)
	}));
	return { paths: [withBulges(list, closed)], faces: [], closed };
}

// ---------------------------------------------------------------------------
// MESH (AcDbSubDMesh): a vertex list followed by a flat face list of
// `[n, i1..in, n, i1..in, ...]` zero-based indices under code 90.

function subdMesh(entity: Entity): Point3[][] {
	const vertices = vertexList(entity).map((v) => v.point);
	const start = entity.findIndex((p) => p.code === 93);
	if (start < 0) return [];
	const listSize = Number(entity[start].value);
	const ints: number[] = [];
	for (let i = start + 1; i < entity.length && ints.length < listSize; i++) {
		if (entity[i].code === 90) ints.push(Number(entity[i].value));
	}
	const faces: Point3[][] = [];
	for (let i = 0; i < ints.length;) {
		const n = ints[i];
		const corners = ints.slice(i + 1, i + 1 + n).map((index) => vertices[index]);
		if (n >= 3 && corners.every(Boolean)) faces.push(corners);
		i += n + 1;
		if (n <= 0) break;
	}
	return faces;
}

// ---------------------------------------------------------------------------
// Entity conversion

interface Sink {
	path(layer: string, points: Point3[], closed: boolean): void;
	face(layer: string, points: Point3[]): void;
}

function convertEntities(
	entities: Entity[],
	blockTable: Map<string, Block>,
	transform: Transform,
	depth: number,
	sink: Sink
): void {
	let pending: { header: Entity; vertices: Entity[] } | null = null;

	const emitPolyline = () => {
		if (!pending) return;
		const layer = firstValue(pending.header, 8) ?? '0';
		const result = polyline(pending.header, pending.vertices);
		for (const points of result.paths) sink.path(layer, points.map(transform), result.closed);
		for (const face of result.faces) sink.face(layer, face.map(transform));
		pending = null;
	};

	for (const entity of entities) {
		const kind = entity[0].value;
		if (kind === 'VERTEX') {
			pending?.vertices.push(entity);
			continue;
		}
		if (kind === 'SEQEND') {
			emitPolyline();
			continue;
		}
		emitPolyline();

		const layer = firstValue(entity, 8) ?? '0';
		const path = (points: Point3[], closed: boolean) =>
			sink.path(layer, points.map(transform), closed);

		switch (kind) {
			case 'LINE':
				path(
					[
						{ x: num(entity, 10), y: num(entity, 20), z: num(entity, 30) },
						{ x: num(entity, 11), y: num(entity, 21), z: num(entity, 31) }
					],
					false
				);
				break;
			case 'LWPOLYLINE': {
				const elevation = num(entity, 38);
				const vertices = vertexList(entity, 42).map((v) => ({
					...v,
					point: { ...v.point, z: elevation }
				}));
				const closed = (num(entity, 70) & POLYLINE_CLOSED) !== 0;
				path(withBulges(vertices, closed), closed);
				break;
			}
			case 'POLYLINE':
				pending = { header: entity, vertices: [] };
				break;
			case 'CIRCLE':
				path(
					arcPoints(num(entity, 10), num(entity, 20), num(entity, 30), num(entity, 40), 0, 360),
					true
				);
				break;
			case 'ARC':
				path(
					arcPoints(
						num(entity, 10),
						num(entity, 20),
						num(entity, 30),
						num(entity, 40),
						num(entity, 50),
						num(entity, 51, 360)
					),
					false
				);
				break;
			case 'ELLIPSE': {
				const cx = num(entity, 10);
				const cy = num(entity, 20);
				const cz = num(entity, 30);
				const mx = num(entity, 11);
				const my = num(entity, 21);
				const ratio = num(entity, 40, 1);
				const start = num(entity, 41, 0);
				const end = num(entity, 42, Math.PI * 2);
				let sweep = end - start;
				while (sweep <= 0) sweep += Math.PI * 2;
				const steps = Math.max(8, Math.ceil(sweep / degreesToRadians(ARC_SEGMENT_DEGREES)));
				const points: Point3[] = [];
				for (let i = 0; i <= steps; i++) {
					const t = start + (sweep * i) / steps;
					const c = Math.cos(t);
					const s = Math.sin(t);
					points.push({ x: cx + mx * c - my * ratio * s, y: cy + my * c + mx * ratio * s, z: cz });
				}
				path(points, Math.abs(sweep - Math.PI * 2) < 1e-9);
				break;
			}
			case 'SPLINE':
				// Drawing the control polygon is a coarse but honest approximation.
				path(
					vertexList(entity).map((v) => v.point),
					(num(entity, 70) & POLYLINE_CLOSED) !== 0
				);
				break;
			case 'POINT':
				path([{ x: num(entity, 10), y: num(entity, 20), z: num(entity, 30) }], false);
				break;
			case '3DFACE': {
				const corners = [
					{ x: num(entity, 10), y: num(entity, 20), z: num(entity, 30) },
					{ x: num(entity, 11), y: num(entity, 21), z: num(entity, 31) },
					{ x: num(entity, 12), y: num(entity, 22), z: num(entity, 32) }
				];
				if (firstValue(entity, 13) !== undefined) {
					const fourth = { x: num(entity, 13), y: num(entity, 23), z: num(entity, 33) };
					const third = corners[2];
					if (fourth.x !== third.x || fourth.y !== third.y || fourth.z !== third.z)
						corners.push(fourth);
				}
				sink.face(layer, corners.map(transform));
				break;
			}
			case 'MESH':
				for (const face of subdMesh(entity)) sink.face(layer, face.map(transform));
				break;
			case 'INSERT': {
				const block = blockTable.get(firstValue(entity, 2) ?? '');
				if (!block || depth >= MAX_INSERT_DEPTH) break;
				const local = insertTransform(
					block.base,
					{ x: num(entity, 41, 1), y: num(entity, 42, 1), z: num(entity, 43, 1) },
					degreesToRadians(num(entity, 50)),
					{ x: num(entity, 10), y: num(entity, 20), z: num(entity, 30) }
				);
				const nested = compose(transform, local);
				const columns = Math.max(1, num(entity, 70, 1));
				const rows = Math.max(1, num(entity, 71, 1));
				const colSpacing = num(entity, 44);
				const rowSpacing = num(entity, 45);
				for (let r = 0; r < rows; r++) {
					for (let c = 0; c < columns; c++) {
						const dx = c * colSpacing;
						const dy = r * rowSpacing;
						const offset: Transform = (p) => ({ x: p.x + dx, y: p.y + dy, z: p.z });
						convertEntities(block.entities, blockTable, compose(nested, offset), depth + 1, sink);
					}
				}
				break;
			}
			default:
				break;
		}
	}
	emitPolyline();
}

// ---------------------------------------------------------------------------

export function parseDxf(text: string): DxfDrawing {
	const table = sections(tokenize(text));
	const blockTable = blocks(table.get('BLOCKS'));
	const paths: DxfPath[] = [];
	const faces: DxfFace[] = [];

	convertEntities(table.get('ENTITIES') ?? [], blockTable, IDENTITY, 0, {
		path(layer, points, closed) {
			if (points.length >= 1) paths.push({ layer, points, closed });
		},
		face(layer, points) {
			if (points.length >= 3) faces.push({ layer, points });
		}
	});

	return { paths, faces, bounds: computeBounds(paths, faces) };
}

export function computeBounds(paths: DxfPath[], faces: DxfFace[]): DxfBounds | null {
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	const extend = ({ x, y, z }: Point3) => {
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
		min.x = Math.min(min.x, x);
		min.y = Math.min(min.y, y);
		min.z = Math.min(min.z, z);
		max.x = Math.max(max.x, x);
		max.y = Math.max(max.y, y);
		max.z = Math.max(max.z, z);
	};
	for (const path of paths) path.points.forEach(extend);
	for (const face of faces) face.points.forEach(extend);
	if (!Number.isFinite(min.x)) return null;
	return { min, max };
}

/** True when anything in the drawing leaves the XY plane. */
export function isThreeDimensional(drawing: DxfDrawing): boolean {
	return (
		drawing.faces.length > 0 ||
		(drawing.bounds !== null && drawing.bounds.max.z - drawing.bounds.min.z > 1e-9)
	);
}
