import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { generateGhost } from '../src/ghostGenerator.js';
import { createSolidProcessor } from '../src/solidProcessor.js';
import { makeEyePlacement } from '../src/eyeProjection.js';
import { validateSolid } from '../src/meshUtils.js';

const processor = await createSolidProcessor();
const outer = generateGhost(new THREE.CylinderGeometry(20, 20, 60, 64).rotateX(Math.PI / 2), new THREE.Matrix4(), { bottomSpread: 0, foldDepth: 0, asymmetry: 0, clearance: 0 });
const settings = { hollow: true, eyes: true, eyeMode: 'placed' };
after(() => processor.clear());
function eye(angle, z = 35, shape = 'round', width = 4, height = 7) {
  const outward = new THREE.Vector3(Math.sin(angle), -Math.cos(angle), 0);
  const point = outward.clone().multiplyScalar(20); point.z = z;
  return makeEyePlacement(point, outward.clone().negate(), new THREE.Vector3(0, 0, 1), { eyeShape: shape, eyeWidth: width, eyeHeight: height });
}

test('click mode accepts zero, one, and many independent eye openings', () => {
  const empty = processor.process(outer, { ...settings, placedEyes: [] });
  assert.equal(empty.userData.eyeCount, 0); validateSolid(empty);
  const placed = Array.from({ length: 7 }, (_, i) => eye(i * Math.PI * 2 / 7, i % 2 ? 40 : 28, i % 2 ? 'oval' : 'round'));
  for (const count of [1, 7]) {
    const result = processor.process(outer, { ...settings, placedEyes: placed.slice(0, count) });
    validateSolid(result); assert.equal(result.userData.eyeCount, count);
    const bvh = new MeshBVH(result, { indirect: true });
    for (const e of placed.slice(0, count)) {
      const direction = new THREE.Vector3(...e.direction);
      const point = new THREE.Vector3(...e.point);
      const origin = point.clone().addScaledVector(direction, -50);
      const hit = bvh.raycastFirst(new THREE.Ray(origin, direction), THREE.DoubleSide);
      assert.ok(hit.distance > 65, 'ray passes through the clicked near wall into the cavity');
    }
    const bytes = new STLExporter().parse(new THREE.Mesh(result), { binary: true });
    const imported = new STLLoader().parse(bytes.buffer); imported.deleteAttribute('normal');
    validateSolid(mergeVertices(imported, 1e-6));
  }
});

test('tilted camera projection cuts along the ray, preserving its ellipse frame', () => {
  const clicked = makeEyePlacement(new THREE.Vector3(0, -20, 35), new THREE.Vector3(0.12, 1, -0.25), new THREE.Vector3(0, 0.2, 1), { eyeShape: 'oval', eyeWidth: 4, eyeHeight: 8 });
  assert.ok(Math.abs(new THREE.Vector3(...clicked.direction).dot(new THREE.Vector3(...clicked.up))) < 1e-10);
  const result = processor.process(outer, { ...settings, placedEyes: [clicked] });
  validateSolid(result);
  const bvh = new MeshBVH(result, { indirect: true });
  const direction = new THREE.Vector3(...clicked.direction), point = new THREE.Vector3(...clicked.point);
  const hit = bvh.raycastFirst(new THREE.Ray(point.clone().addScaledVector(direction, -50), direction), THREE.DoubleSide);
  assert.ok(hit.distance > 65);
  assert.deepEqual(result.userData.eyePaths[0].direction, clicked.direction);
});

test('placements retain individual sizes and do not depend on pair settings', () => {
  const placements = [eye(0), eye(Math.PI / 2, 40, 'oval', 5, 9)];
  const a = processor.process(outer, { ...settings, placedEyes: placements });
  const b = processor.process(outer, { ...settings, placedEyes: placements, eyeWidth: 50, eyeSpacing: 1, eyeHeight: 80, eyeAngle: 120 });
  assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
  assert.equal(placements[0].width, placements[0].height);
  assert.equal(placements[1].height, 9);
});

test('invalid projected openings identify the eye that needs removal', () => {
  const invalid = { ...eye(0), point: [1000, 0, 40] };
  assert.throws(() => processor.process(outer, { ...settings, placedEyes: [eye(0), invalid] }), /Eye 2:.*interior/);
  assert.throws(() => processor.process(outer, { ...settings, placedEyes: [{ ...eye(0), direction: [0, 0, 0] }] }), /Eye 1:.*direction/);
  assert.throws(() => processor.process(outer, { ...settings, placedEyes: [eye(0, 1, 'oval', 4, 9)] }), /Eye 1:.*interior/);
});
