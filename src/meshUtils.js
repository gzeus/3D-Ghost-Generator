import * as THREE from 'three';

export function orientGeometry(source, transform = new THREE.Matrix4(), targetSize = null) {
  if (targetSize !== null && (!Number.isFinite(targetSize) || targetSize <= 0)) throw new Error('Target size must be a positive number in millimetres.');
  const geometry = source.clone().applyMatrix4(transform);
  geometry.computeBoundingBox();
  if (targetSize !== null) {
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!(longest > 0)) { geometry.dispose(); throw new Error('The source has no measurable size.'); }
    const scale = targetSize / longest;
    geometry.scale(scale, scale, scale); geometry.computeBoundingBox();
  }
  const box = geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -box.min.z);
  geometry.computeBoundingBox();
  return geometry;
}

// Validate actual indexed topology, triangle area, winding, volume and base.
export function validateSolid(geometry) {
  const p = geometry.getAttribute('position');
  const indices = geometry.index?.array;
  if (!indices) throw new Error('Expected indexed geometry.');
  const edges = new Map();
  const positions = new Set();
  let volume = 0, minZ = Infinity, maxZ = -Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) throw new Error('Non-finite vertex.');
    const position = `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    if (positions.has(position)) throw new Error('Coincident surface vertices would pinch the exported STL. Try a slightly different thickness or smoothing.');
    positions.add(position);
    minZ = Math.min(minZ, p.getZ(i)); maxZ = Math.max(maxZ, p.getZ(i));
  }
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [indices[i], indices[i + 1], indices[i + 2]];
    a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
    if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq() <= 1e-18) throw new Error('Degenerate triangle.');
    volume += a.dot(ab.crossVectors(b, c)) / 6;
    for (let j = 0; j < 3; j++) {
      const u = ids[j], v = ids[(j + 1) % 3], key = `${Math.min(u, v)}:${Math.max(u, v)}`;
      const edge = edges.get(key) || { count: 0, balance: 0 };
      edge.count++; edge.balance += u < v ? 1 : -1; edges.set(key, edge);
    }
  }
  if ([...edges.values()].some(e => e.count !== 2 || e.balance !== 0)) throw new Error('Mesh is not closed with consistent winding.');
  if (minZ !== 0 || maxZ <= 0 || volume <= 0) throw new Error('Invalid base or solid volume.');
  return { vertices: p.count, triangles: indices.length / 3, volume, height: maxZ, watertight: true };
}
