import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { generateGhost } from '../src/ghostGenerator.js';
import { createSolidProcessor } from '../src/solidProcessor.js';
import { validateSolid } from '../src/meshUtils.js';
import { demoGeometry } from '../src/stlImport.js';

const processor = await createSolidProcessor();
const outer = generateGhost(new THREE.CylinderGeometry(20, 20, 60, 64).rotateX(Math.PI / 2), new THREE.Matrix4(), { bottomSpread: 0, foldDepth: 0, asymmetry: 0, clearance: 0 });
after(() => processor.clear());
const hits = (geometry, origin, direction) => new MeshBVH(geometry, { indirect: true }).raycast(new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction)), THREE.DoubleSide).sort((a, b) => a.distance - b.distance);
const first = (geometry, origin, direction) => hits(geometry, origin, direction)[0];

test('hollow shell has an open underside, manifold rim and measured 2 mm walls', () => {
  const hollow = processor.process(outer, { hollow: true });
  assert.ok(validateSolid(hollow).volume < validateSolid(outer).volume * 0.4);
  const radial = hits(hollow, [0, 0, 20], [1, 0, 0]);
  assert.ok(Math.abs(radial[0].point.x - 18) < 0.12, `inner wall at ${radial[0].point.x}`);
  const exit = radial.find(h => h.point.x > 19.9);
  assert.ok(Math.abs(exit.point.x - radial[0].point.x - 2) < 0.12);
  assert.ok(first(hollow, [0, 0, -1], [0, 0, 1]).point.z > 50, 'base is open, ray reaches roof');
  assert.equal(hollow.boundingBox.min.z, 0);
});

test('round and oval eyes cut into the cavity and preserve the rear wall', () => {
  for (const shape of ['round', 'oval']) {
    const eye = processor.process(outer, { hollow: true, eyes: true, eyeShape: shape });
    validateSolid(eye);
    const z = outer.boundingBox.max.z * 0.65;
    for (const x of [-6.5, 6.5]) {
      assert.ok(first(eye, [x, -100, z], [0, 1, 0]).point.y > 0, 'center sees the inner rear wall, not the front');
      assert.ok(first(eye, [x, 100, z], [0, -1, 0]).point.y > 15, 'outer back is intact');
    }
    assert.ok(first(eye, [0, -100, z], [0, 1, 0]).point.y < -15, 'bridge between eyes remains');
    const highRay = first(eye, [6.5, -100, z + 3.8], [0, 1, 0]);
    assert.equal(highRay.point.y > 0, shape === 'oval', 'oval height and circular diameter differ');
  }
});

test('face rotation moves the holes to another side', () => {
  const eye = processor.process(outer, { hollow: true, eyes: true, eyeAngle: 90 });
  const z = outer.boundingBox.max.z * 0.65;
  assert.ok(first(eye, [100, 6.5, z], [-1, 0, 0]).point.x < 0);
  assert.ok(first(eye, [6.5, -100, z], [0, 1, 0]).point.y < -15);
  validateSolid(eye);
});

test('closed floor and larger thickness produce the expected floor and wall', () => {
  const hollow = processor.process(outer, { hollow: true, openBottom: false, wallThickness: 3 });
  validateSolid(hollow);
  const vertical = hits(hollow, [0.13, 0.17, -1], [0, 0, 1]);
  assert.equal(vertical[0].point.z, 0);
  assert.ok(Math.abs(vertical[1].point.z - 3) < 0.1);
  assert.ok(Math.abs(first(hollow, [0, 0, 20], [1, 0, 0]).point.x - 17) < 0.12);
  const eyes = processor.process(outer, { hollow: true, openBottom: false, wallThickness: 3, eyes: true });
  validateSolid(eyes);
});

test('folded hollow rabbit with eyes survives an STL round trip', () => {
  const rabbit = generateGhost(demoGeometry());
  const hollow = processor.process(rabbit, { hollow: true });
  const outerBVH = new MeshBVH(rabbit, { indirect: true });
  const point = new THREE.Vector3(), target = { point: new THREE.Vector3() };
  let measured = 0;
  for (let i = 0; i < hollow.attributes.position.count; i += 3) {
    point.fromBufferAttribute(hollow.attributes.position, i);
    if (point.z < 3) continue; // The intentionally open rim has no floor thickness.
    const distance = outerBVH.closestPointToPoint(point, target).distance;
    if (distance < 0.01) continue; // Unchanged exterior vertices.
    assert.ok(distance > 1.8 && distance < 2.25, `folded inner surface is ${distance} mm from outer surface`);
    measured++;
  }
  assert.ok(measured > 1000);
  const eye = processor.process(rabbit, { hollow: true, eyes: true });
  validateSolid(eye);
  const data = new STLExporter().parse(new THREE.Mesh(eye), { binary: true });
  const imported = new STLLoader().parse(data.buffer); imported.deleteAttribute('normal');
  const welded = mergeVertices(imported, 1e-6);
  assert.equal(validateSolid(welded).watertight, true);
  assert.equal(welded.index.count, eye.index.count);
});

test('invalid thickness and eyes fail clearly instead of exporting blind recesses', () => {
  assert.throws(() => processor.process(outer, { hollow: true, wallThickness: 0 }), /thickness/);
  assert.throws(() => processor.process(outer, { eyes: true }), /hollow interior/);
  assert.throws(() => processor.process(outer, { hollow: true, eyes: true, eyeSpacing: 2 }), /spacing/);
  assert.throws(() => processor.process(outer, { hollow: true, eyes: true, eyeWidth: 35, eyeSpacing: 40 }), /interior|depth/);
  assert.throws(() => processor.process(outer, { hollow: true, wallThickness: 30 }), /interior/);
});
