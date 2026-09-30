import * as THREE from 'three';
import { importSTL, demoGeometry } from './stlImport.js';
import { generateGhost, defaults } from './ghostGenerator.js';
import { orientGeometry, validateSolid } from './meshUtils.js';
import { createSolidProcessor } from './solidProcessor.js';
import wasmURL from 'manifold-3d/manifold.wasm?url';

let source, cachedOuter, outerKey, processor, processorPromise;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const next = data.buffer ? importSTL(data.buffer) : demoGeometry();
      source?.dispose(); source = next;
      cachedOuter?.dispose(); cachedOuter = undefined; outerKey = undefined; processor?.clear();
      const plain = source.index ? source.toNonIndexed() : source.clone();
      const positions = plain.attributes.position.array.slice(); plain.dispose();
      self.postMessage({ type: 'loaded', positions }, [positions.buffer]);
      return;
    }
    if (!source) throw new Error('Load an STL first.');
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...data.rotation.map(THREE.MathUtils.degToRad), 'XYZ'));
    const key = JSON.stringify([data.rotation, Object.keys(defaults).map(k => data.params[k] ?? defaults[k])]);
    if (key !== outerKey) {
      const next = generateGhost(source, matrix, data.params);
      processor?.clear(); cachedOuter?.dispose(); cachedOuter = next; outerKey = key;
    }
    let result;
    if (data.params.hollow || data.params.eyes) {
      self.postMessage({ type: 'progress', id: data.id, message: 'Hollowing the sheet and cutting openings…' });
      processorPromise ??= createSolidProcessor({ locateFile: () => wasmURL }).catch(error => { processorPromise = undefined; throw error; });
      processor = await processorPromise;
      result = processor.process(cachedOuter, data.params);
    } else { result = cachedOuter.clone(); }
    let stats;
    try { stats = validateSolid(result); }
    catch (error) { result.dispose(); throw error; }
    const oriented = orientGeometry(source, matrix);
    const size = oriented.boundingBox.getSize(new THREE.Vector3()); oriented.dispose();
    const positions = result.attributes.position.array;
    const indices = result.index.array;
    self.postMessage({ type: 'generated', id: data.id, positions, indices, stats, debug: result.userData, flat: size.z < Math.max(size.x, size.y) * 0.1 }, [positions.buffer, indices.buffer]);
    result.dispose();
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message || 'Could not process this model.' }); }
};
