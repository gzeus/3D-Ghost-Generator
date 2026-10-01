import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateGhost } from '../src/ghostGenerator.js';
import { demoGeometry } from '../src/stlImport.js';
import { orientGeometry, validateSolid } from '../src/meshUtils.js';

test('crown tapers continuously with increasing curvature instead of a second raised dome', () => {
  for (const source of [demoGeometry(), new THREE.SphereGeometry(30, 48, 32), new THREE.BoxGeometry(35, 25, 75)]) {
    const ghost = generateGhost(source);
    validateSolid(ghost);
    const { ringCount, angularSamples: n, crownJoinZ } = ghost.userData;
    const p = ghost.attributes.position;
    const top = new THREE.Vector3().fromBufferAttribute(p, p.count - 1);
    for (const angle of [0, 16, 32, 48]) {
      let previousRadius, previousZ, previousSlope = 0, checked = 0;
      for (let l = 0; l < ringCount; l++) {
        const i = l * n + angle, z = p.getZ(i);
        if (z < crownJoinZ - 1e-5) continue;
        const radius = Math.hypot(p.getX(i) - top.x, p.getY(i) - top.y);
        if (previousRadius !== undefined) {
          const slope = (radius - previousRadius) / (z - previousZ);
          assert.ok(slope < 0, 'crown narrows at every ring');
          assert.ok(slope <= previousSlope + 0.002, 'no slope reset or bunched-up secondary cap');
          previousSlope = slope; checked++;
        }
        previousRadius = radius; previousZ = z;
      }
      assert.ok(checked >= 20);
      assert.ok((top.z - previousZ) / previousRadius < 0.1, 'apex approaches a horizontal tangent, not a cone');
    }
  }
});

test('target size scales uniformly after orientation and keeps the source centered and grounded', () => {
  const original = new THREE.BoxGeometry(20, 40, 80).translate(100, -30, 40);
  const matrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const scaled = orientGeometry(original, matrix, 120);
  const box = scaled.boundingBox, size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 30) < 1e-4);
  assert.ok(Math.abs(size.y - 120) < 1e-4);
  assert.ok(Math.abs(size.z - 60) < 1e-4);
  assert.equal(box.min.z, 0); assert.equal(box.min.x + box.max.x, 0); assert.equal(box.min.y + box.max.y, 0);
  const restored = orientGeometry(original, matrix);
  assert.ok(Math.abs(restored.boundingBox.getSize(new THREE.Vector3()).y - 80) < 1e-4);
});

test('source scaling reaches generation while millimetre clearances stay absolute', () => {
  const source = new THREE.CylinderGeometry(10, 10, 40, 64).rotateX(Math.PI / 2);
  const params = { cutoff: 0.5, targetSize: 80, bottomSpread: 0, foldDepth: 0, asymmetry: 0, clearance: 2 };
  const scaled = generateGhost(source, new THREE.Matrix4(), params);
  const noClearance = generateGhost(source, new THREE.Matrix4(), { ...params, clearance: 0 });
  validateSolid(scaled);
  assert.ok(Math.abs(noClearance.attributes.position.getX(0) - 20) < 0.1, 'source radius doubles, allowing for contour smoothing');
  assert.ok(Math.abs(scaled.attributes.position.getX(0) - noClearance.attributes.position.getX(0) - 2) < 1e-5, 'clearance remains exactly 2 mm instead of scaling with the source');
  assert.ok(Math.abs(scaled.userData.sampled[0].z - 40) < 0.01, 'cutoff is relative to scaled source');
  assert.ok(scaled.boundingBox.max.z >= 82);
  assert.throws(() => generateGhost(source, new THREE.Matrix4(), { targetSize: 0 }), /Target size/);
  assert.throws(() => orientGeometry(source, new THREE.Matrix4(), -10), /Target size/);
  assert.throws(() => orientGeometry(source, new THREE.Matrix4(), NaN), /Target size/);
});
