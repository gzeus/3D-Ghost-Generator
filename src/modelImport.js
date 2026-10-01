import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { importSTL } from './stlImport.js';
import { import3MF } from './threeMFImport.js';
import { orientGeometry } from './meshUtils.js';

function importOBJ(buffer) {
  const group = new OBJLoader().parse(new TextDecoder().decode(buffer));
  group.updateMatrixWorld(true);
  const meshes = []; let count = 0;
  try {
    group.traverse(object => {
      if (!object.isMesh) return;
      const geometry = object.geometry;
      count += geometry.index?.count ?? geometry.attributes.position.count;
      meshes.push(object);
    });
    if (!count) throw new Error('The OBJ contains no polygon faces. Points and lines cannot form a ghost.');
    if (count / 3 > 2000000) throw new Error('Please simplify the model to fewer than 2 million triangles.');
    const positions = new Float32Array(count * 3), point = new THREE.Vector3(); let offset = 0;
    for (const object of meshes) {
      const geometry = object.geometry, p = geometry.attributes.position;
      for (let i = 0; i < (geometry.index?.count ?? p.count); i++) {
        point.fromBufferAttribute(p, geometry.index ? geometry.index.getX(i) : i).applyMatrix4(object.matrixWorld);
        point.toArray(positions, offset); offset += 3;
      }
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
  } finally {
    group.traverse(object => { object.geometry?.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose(); });
  }
}

export function importModel(buffer, filename) {
  if (buffer.byteLength > 120 * 1024 * 1024) throw new Error('Choose a model smaller than 120 MB.');
  const extension = filename.split('.').at(-1).toLowerCase();
  if (extension === 'stl') return importSTL(buffer);
  if (!['obj', '3mf'].includes(extension)) throw new Error('Choose an STL, OBJ, or 3MF file.');
  let geometry;
  try {
    geometry = extension === 'obj' ? importOBJ(buffer) : import3MF(buffer);
    const p = geometry.attributes.position;
    if (!p || p.count < 3 || p.count % 3) throw new Error('The model contains no complete triangles.');
    for (const value of p.array) if (!Number.isFinite(value)) throw new Error('The model contains invalid coordinates.');
    return orientGeometry(geometry);
  } catch (error) { throw new Error(`Could not read ${extension.toUpperCase()}: ${error.message}`); }
  finally { geometry?.dispose(); }
}
