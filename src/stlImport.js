import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { orientGeometry } from './meshUtils.js';

export function importSTL(buffer) {
  if (buffer.byteLength > 120 * 1024 * 1024) throw new Error('Please use an STL smaller than 120 MB.');
  const geometry = new STLLoader().parse(buffer);
  const p = geometry.attributes.position;
  if (!p || p.count < 3 || p.count % 3 !== 0) throw new Error('The file contains no complete triangles.');
  if (p.count / 3 > 2000000) throw new Error('Please simplify this STL to fewer than 2 million triangles.');
  for (const v of p.array) if (!Number.isFinite(v)) throw new Error('The STL contains invalid coordinates.');
  const result = orientGeometry(geometry); geometry.dispose();
  return result;
}

export function demoGeometry() {
  // A little rabbit figurine, intentionally composed of disconnected volumes.
  const parts = [
    [0, 0, 23, 16, 12, 23], [0, 0, 48, 14, 12, 15],
    [-8, 0, 69, 5, 5, 18], [8, 0, 69, 5, 5, 18],
    [-12, -3, 7, 8, 11, 7], [12, -3, 7, 8, 11, 7],
    [0, 12, 17, 8, 8, 8]
  ].map(([x, y, z, sx, sy, sz]) => new THREE.SphereGeometry(1, 32, 24).scale(sx, sy, sz).translate(x, y, z));
  const result = mergeGeometries(parts); parts.forEach(p => p.dispose()); return result;
}
