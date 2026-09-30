import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { generateGhost } from '../src/ghostGenerator.js';
import { validateSolid, orientGeometry } from '../src/meshUtils.js';
import { demoGeometry, importSTL } from '../src/stlImport.js';

test('rabbit produces a deterministic closed solid with exact planar base', () => {
  const source = demoGeometry();
  const a = generateGhost(source), b = generateGhost(source);
  const stats = validateSolid(a);
  assert.ok(stats.volume > 0); assert.ok(stats.triangles > 20000);
  assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
  const p = a.attributes.position;
  for (let i = 0; i < 128; i++) assert.equal(p.getZ(i), 0);
  assert.equal(p.getZ(p.count - 2), 0);
});

test('cutoff and fold extremes remain manifold, including zero clearance', () => {
  const source = demoGeometry();
  for (const cutoff of [0, 0.58, 1]) for (const foldCount of [3, 16]) {
    const g = generateGhost(source, new THREE.Matrix4(), { cutoff, foldCount, foldDepth: 15, clearance: 0, bottomSpread: 0, asymmetry: 1, foldIrregularity: 1 });
    assert.equal(validateSolid(g).watertight, true);
  }
});

test('binary STL round trip is watertight after exact-position welding', () => {
  const ghost = generateGhost(demoGeometry());
  const data = new STLExporter().parse(new THREE.Mesh(ghost), { binary: true });
  const reimport = new STLLoader().parse(data.buffer);
  reimport.deleteAttribute('normal');
  const welded = mergeVertices(reimport, 1e-6);
  assert.equal(validateSolid(welded).watertight, true);
  assert.equal(welded.index.count, ghost.index.count);
});

test('orientation recenters an off-center STL and rests it on the floor', () => {
  const source = new THREE.BoxGeometry(20, 40, 80).translate(200, -300, 400);
  const transform = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const oriented = orientGeometry(source, transform);
  const b = oriented.boundingBox;
  assert.equal(b.min.z, 0);
  assert.ok(Math.abs(b.min.x + b.max.x) < 1e-5);
  assert.ok(Math.abs(b.min.y + b.max.y) < 1e-5);
  assert.ok(Math.abs(b.max.z - 40) < 1e-4);
  assert.equal(validateSolid(generateGhost(source, transform)).watertight, true);
});

test('missing height sections between disconnected pieces are interpolated', () => {
  const source = mergeGeometries([new THREE.BoxGeometry(10,10,10), new THREE.BoxGeometry(6,6,10).translate(12,0,40)]);
  assert.equal(validateSolid(generateGhost(source, new THREE.Matrix4(), { cutoff: 0 })).watertight, true);
});

test('spread, fold depth and skirt height change the result predictably', () => {
  const source = new THREE.CylinderGeometry(10, 10, 40, 64).rotateX(Math.PI / 2);
  const narrow = generateGhost(source, new THREE.Matrix4(), { bottomSpread: 0, foldDepth: 0 });
  const wide = generateGhost(source, new THREE.Matrix4(), { bottomSpread: 1, foldDepth: 0 });
  assert.ok(wide.boundingBox.max.x > narrow.boundingBox.max.x + 5);
  const tall = generateGhost(source, new THREE.Matrix4(), { skirtHeight: 100 });
  assert.ok(tall.boundingBox.max.z > narrow.boundingBox.max.z + 60);
  const folded = generateGhost(source, new THREE.Matrix4(), { foldDepth: 10 });
  assert.notDeepEqual(folded.attributes.position.array, narrow.attributes.position.array);
  validateSolid(tall); validateSolid(folded);
});

test('flat and invalid inputs fail with useful errors', () => {
  assert.throws(() => generateGhost(new THREE.PlaneGeometry(30,30)), /height/);
  assert.throws(() => generateGhost(demoGeometry(), new THREE.Matrix4(), { skirtHeight: -1 }), /positive/);
  assert.throws(() => importSTL(new TextEncoder().encode('not an stl').buffer));
});
