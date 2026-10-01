import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importModel } from '../src/modelImport.js';
import { orientGeometry, validateSolid } from '../src/meshUtils.js';
import { generateGhost } from '../src/ghostGenerator.js';
import { archive3MF, tetraMesh, modelXML, wideOBJ } from './import-fixtures.js';

const size = geometry => { geometry.computeBoundingBox(); return geometry.boundingBox.getSize(new THREE.Vector3()).toArray(); };
const textBuffer = text => new TextEncoder().encode(text).buffer;

test('OBJ imports polygon faces and negative indices, without loading an MTL', () => {
  const geometry = importModel(textBuffer(wideOBJ), 'wide.OBJ');
  assert.deepEqual(size(geometry), [100, 20, 10]);
  assert.equal(geometry.attributes.position.count, 36);
  const scaled = orientGeometry(geometry, new THREE.Matrix4(), 50);
  assert.deepEqual(size(scaled), [500, 100, 50], 'height uses Z even when X is much wider');
  validateSolid(generateGhost(geometry, new THREE.Matrix4(), { targetSize: 50 }));
});

test('3MF uses build components, transforms and centimetre units', () => {
  const model = modelXML(`<object id="1">${tetraMesh}</object><object id="2"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 4 0 0"/></components></object><object id="99">${tetraMesh}</object>`, '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 20 30"/>', 'centimeter');
  const geometry = importModel(archive3MF(model), 'assembly.3mf');
  assert.deepEqual(size(geometry), [50, 20, 30]);
  assert.equal(geometry.attributes.position.count, 24, 'only build-referenced objects are included');
  assert.equal(geometry.boundingBox.min.z, 0);
  validateSolid(generateGhost(geometry));
});

test('3MF resolves production-extension component parts in the same archive', () => {
  const root = modelXML('<object id="1"><components><component p:path="/3D/Objects/part.model" objectid="7" transform="2 0 0 0 1 0 0 0 1 4 0 0"/></components></object>', '<item objectid="1"/>');
  const child = modelXML(`<object id="7">${tetraMesh}</object>`, '');
  const geometry = importModel(archive3MF(root, { '3D/Objects/part.model': child }), 'production.3mf');
  assert.deepEqual(size(geometry), [2, 2, 3]);
});

test('3MF inch units and non-printable build items are handled', () => {
  const model = modelXML(`<object id="1">${tetraMesh}</object>`, '<item objectid="1"/><item objectid="missing" printable="false"/>', 'inch');
  const actual = size(importModel(archive3MF(model), 'inches.3mf'));
  [25.4, 50.8, 76.2].forEach((value, i) => assert.ok(Math.abs(actual[i] - value) < 1e-4));
});

test('bad models report errors instead of producing partial assemblies', () => {
  assert.throws(() => importModel(textBuffer('v 0 0 0'), 'points.obj'), /no polygon faces/);
  assert.throws(() => importModel(textBuffer('not a zip'), 'broken.3mf'), /Could not read 3MF/);
  const loop = modelXML('<object id="1"><components><component objectid="1"/></components></object>', '<item objectid="1"/>');
  assert.throws(() => importModel(archive3MF(loop), 'loop.3mf'), /circular/);
  const missing = modelXML('<object id="1"><components><component p:path="/missing.model" objectid="7"/></components></object>', '<item objectid="1"/>');
  assert.throws(() => importModel(archive3MF(missing), 'missing.3mf'), /Missing embedded/);
  const broken = modelXML(`<object id="1">${tetraMesh.replace('v1="0"', 'v1="99"')}</object>`, '<item objectid="1"/>');
  assert.throws(() => importModel(archive3MF(broken), 'bad-index.3mf'), /invalid vertex indices/);
  assert.throws(() => orientGeometry(new THREE.PlaneGeometry(20, 20), new THREE.Matrix4(), 50), /no measurable Z height/);
});
