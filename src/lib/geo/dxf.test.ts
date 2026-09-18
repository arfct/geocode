import { describe, expect, it } from 'vitest';
import { isThreeDimensional, parseDxf } from './dxf.js';

const section = (name: string, body: string) =>
	['0\nSECTION\n2\n' + name, body, '0\nENDSEC'].filter(Boolean).join('\n');
const dxf = (entities: string, blocks = '') =>
	[
		section('HEADER', ''),
		blocks && section('BLOCKS', blocks),
		section('ENTITIES', entities),
		'0\nEOF'
	]
		.filter(Boolean)
		.join('\n');

describe('parseDxf', () => {
	it('reads a LINE into a two point path with its layer', () => {
		const drawing = parseDxf(dxf('0\nLINE\n8\nWalls\n10\n0\n20\n0\n11\n10\n21\n5'));
		expect(drawing.paths).toEqual([
			{
				layer: 'Walls',
				closed: false,
				points: [
					{ x: 0, y: 0, z: 0 },
					{ x: 10, y: 5, z: 0 }
				]
			}
		]);
		expect(drawing.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 0 } });
		expect(isThreeDimensional(drawing)).toBe(false);
	});

	it('keeps z on lines and treats a non-flat drawing as 3D', () => {
		const drawing = parseDxf(dxf('0\nLINE\n10\n0\n20\n0\n30\n1\n11\n0\n21\n0\n31\n9'));
		expect(drawing.paths[0].points[1].z).toBe(9);
		expect(isThreeDimensional(drawing)).toBe(true);
	});

	it('reads a closed LWPOLYLINE at its elevation', () => {
		const drawing = parseDxf(
			dxf('0\nLWPOLYLINE\n8\n0\n90\n3\n70\n1\n38\n2.5\n10\n0\n20\n0\n10\n4\n20\n0\n10\n4\n20\n3')
		);
		expect(drawing.paths[0].closed).toBe(true);
		expect(drawing.paths[0].points).toHaveLength(3);
		expect(drawing.paths[0].points.every((p) => p.z === 2.5)).toBe(true);
	});

	it('expands a bulge into intermediate arc points', () => {
		// A bulge of 1 is a counter-clockwise semicircle from (0,0) to (2,0), so it dips below the chord.
		const drawing = parseDxf(dxf('0\nLWPOLYLINE\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0'));
		const points = drawing.paths[0].points;
		expect(points.length).toBeGreaterThan(10);
		const bottom = points.reduce((a, b) => (b.y < a.y ? b : a));
		expect(bottom.x).toBeCloseTo(1, 5);
		expect(bottom.y).toBeCloseTo(-1, 5);
	});

	it('assembles POLYLINE / VERTEX / SEQEND', () => {
		const drawing = parseDxf(
			dxf('0\nPOLYLINE\n8\nL\n70\n0\n0\nVERTEX\n10\n1\n20\n1\n0\nVERTEX\n10\n2\n20\n2\n0\nSEQEND')
		);
		expect(drawing.paths).toHaveLength(1);
		expect(drawing.paths[0].points).toEqual([
			{ x: 1, y: 1, z: 0 },
			{ x: 2, y: 2, z: 0 }
		]);
	});

	it('reads a 3D POLYLINE with z on every vertex', () => {
		const drawing = parseDxf(
			dxf(
				'0\nPOLYLINE\n70\n8\n0\nVERTEX\n10\n0\n20\n0\n30\n0\n0\nVERTEX\n10\n0\n20\n0\n30\n5\n0\nSEQEND'
			)
		);
		expect(drawing.paths[0].points[1]).toEqual({ x: 0, y: 0, z: 5 });
	});

	it('reads 3DFACE quads and drops a repeated fourth corner', () => {
		const quad =
			'0\n3DFACE\n8\nRoof\n10\n0\n20\n0\n30\n0\n11\n1\n21\n0\n31\n0\n12\n1\n22\n1\n32\n1\n13\n0\n23\n1\n33\n1';
		const tri =
			'0\n3DFACE\n10\n0\n20\n0\n30\n0\n11\n1\n21\n0\n31\n0\n12\n1\n22\n1\n32\n1\n13\n1\n23\n1\n33\n1';
		const drawing = parseDxf(dxf(`${quad}\n${tri}`));
		expect(drawing.faces).toHaveLength(2);
		expect(drawing.faces[0].layer).toBe('Roof');
		expect(drawing.faces[0].points).toHaveLength(4);
		expect(drawing.faces[1].points).toHaveLength(3);
		expect(isThreeDimensional(drawing)).toBe(true);
	});

	it('builds faces from a polyface mesh', () => {
		const vertex = (x: number, y: number, z: number) =>
			`0\nVERTEX\n70\n192\n10\n${x}\n20\n${y}\n30\n${z}`;
		const face = (a: number, b: number, c: number, d = 0) =>
			`0\nVERTEX\n70\n128\n71\n${a}\n72\n${b}\n73\n${c}\n74\n${d}`;
		const drawing = parseDxf(
			dxf(
				[
					'0\nPOLYLINE\n70\n64\n71\n4\n72\n2',
					vertex(0, 0, 0),
					vertex(1, 0, 0),
					vertex(1, 1, 0),
					vertex(0, 0, 1),
					face(1, 2, 3),
					face(1, 2, 4),
					'0\nSEQEND'
				].join('\n')
			)
		);
		expect(drawing.paths).toHaveLength(0);
		expect(drawing.faces).toHaveLength(2);
		expect(drawing.faces[1].points[2]).toEqual({ x: 0, y: 0, z: 1 });
	});

	it('reads MESH (AcDbSubDMesh) vertex and face lists', () => {
		// A triangular prism: 6 vertices, two triangle caps and three quad sides.
		const vertices = [
			[0, 0, 0],
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 2],
			[1, 0, 2],
			[0, 1, 2]
		]
			.map(([x, y, z]) => `10\n${x}\n20\n${y}\n30\n${z}`)
			.join('\n');
		const faceList = [3, 0, 1, 2, 3, 3, 4, 5, 4, 0, 1, 4, 3, 4, 1, 2, 5, 4, 4, 2, 0, 3, 5];
		const mesh = [
			'0\nMESH\n8\nbuildings\n71\n2\n72\n0\n91\n0\n92\n6',
			vertices,
			`93\n${faceList.length}`,
			...faceList.map((n) => `90\n${n}`)
		].join('\n');
		const drawing = parseDxf(dxf(mesh));
		expect(drawing.faces).toHaveLength(5);
		expect(drawing.faces[0].layer).toBe('buildings');
		expect(drawing.faces[0].points).toHaveLength(3);
		expect(drawing.faces[2].points).toHaveLength(4);
		expect(drawing.faces[2].points[3]).toEqual({ x: 0, y: 0, z: 2 });
		expect(drawing.bounds?.max.z).toBe(2);
	});

	it('builds quads from a polygon mesh grid', () => {
		const vertex = (x: number, y: number, z: number) =>
			`0\nVERTEX\n70\n64\n10\n${x}\n20\n${y}\n30\n${z}`;
		const grid = [vertex(0, 0, 0), vertex(0, 1, 0), vertex(1, 0, 0), vertex(1, 1, 1)];
		const drawing = parseDxf(
			dxf(['0\nPOLYLINE\n70\n16\n71\n2\n72\n2', ...grid, '0\nSEQEND'].join('\n'))
		);
		expect(drawing.faces).toHaveLength(1);
		expect(drawing.faces[0].points).toHaveLength(4);
	});

	it('expands block INSERTs with translation, scale and rotation', () => {
		const block =
			'0\nBLOCK\n2\nBOX\n10\n0\n20\n0\n30\n0\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n0\n0\nENDBLK';
		const insert = '0\nINSERT\n2\nBOX\n10\n10\n20\n10\n30\n3\n41\n2\n42\n2\n43\n2\n50\n90';
		const drawing = parseDxf(dxf(insert, block));
		expect(drawing.paths).toHaveLength(1);
		const [a, b] = drawing.paths[0].points;
		expect(a).toEqual({ x: 10, y: 10, z: 3 });
		expect(b.x).toBeCloseTo(10, 9);
		expect(b.y).toBeCloseTo(12, 9);
		expect(b.z).toBe(3);
	});

	it('repeats INSERT arrays and ignores unknown blocks', () => {
		const block = '0\nBLOCK\n2\nDOT\n0\nPOINT\n10\n0\n20\n0\n0\nENDBLK';
		const insert =
			'0\nINSERT\n2\nDOT\n10\n0\n20\n0\n70\n3\n71\n2\n44\n5\n45\n7\n0\nINSERT\n2\nMISSING';
		const drawing = parseDxf(dxf(insert, block));
		expect(drawing.paths).toHaveLength(6);
		expect(drawing.paths.at(-1)?.points[0]).toEqual({ x: 10, y: 7, z: 0 });
	});

	it('approximates circles and arcs', () => {
		const drawing = parseDxf(
			dxf('0\nCIRCLE\n10\n0\n20\n0\n40\n1\n0\nARC\n10\n0\n20\n0\n40\n2\n50\n0\n51\n90')
		);
		expect(drawing.paths[0].closed).toBe(true);
		expect(drawing.bounds?.min.x).toBeCloseTo(-1, 5);
		const arc = drawing.paths[1];
		expect(arc.points[0]).toEqual({ x: 2, y: 0, z: 0 });
		expect(arc.points.at(-1)?.x).toBeCloseTo(0, 5);
		expect(arc.points.at(-1)?.y).toBeCloseTo(2, 5);
	});

	it('ignores entities outside the ENTITIES section and unknown kinds', () => {
		const text = [
			section('OBJECTS', '0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1'),
			dxf('0\nTEXT\n1\nhello')
		].join('\n');
		expect(parseDxf(text).paths).toEqual([]);
		expect(parseDxf(text).faces).toEqual([]);
		expect(parseDxf(text).bounds).toBeNull();
	});

	it('copes with CRLF line endings', () => {
		const drawing = parseDxf(dxf('0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1').replaceAll('\n', '\r\n'));
		expect(drawing.paths).toHaveLength(1);
	});
});
