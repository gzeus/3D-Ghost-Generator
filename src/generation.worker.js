import * as THREE from 'three';
import { importSTL, demoGeometry } from './stlImport.js';
import { generateGhost } from './ghostGenerator.js';
import { orientGeometry, validateSolid } from './meshUtils.js';

let source;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'load') {
      const next = data.buffer ? importSTL(data.buffer) : demoGeometry();
      source?.dispose(); source = next;
      const plain = source.index ? source.toNonIndexed() : source.clone();
      const positions = plain.attributes.position.array.slice(); plain.dispose();
      self.postMessage({ type: 'loaded', positions }, [positions.buffer]);
      return;
    }
    if (!source) throw new Error('Load an STL first.');
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...data.rotation.map(THREE.MathUtils.degToRad), 'XYZ'));
    const result = generateGhost(source, matrix, data.params);
    const stats = validateSolid(result);
    const oriented = orientGeometry(source, matrix);
    const size = oriented.boundingBox.getSize(new THREE.Vector3()); oriented.dispose();
    const positions = result.attributes.position.array;
    const indices = result.index.array;
    self.postMessage({ type: 'generated', id: data.id, positions, indices, stats, debug: result.userData, flat: size.z < Math.max(size.x, size.y) * 0.1 }, [positions.buffer, indices.buffer]);
    result.dispose();
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message || 'Could not process this model.' }); }
};
