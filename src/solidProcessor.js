import * as THREE from 'three';
import Module from 'manifold-3d';
import { MeshBVH } from 'three-mesh-bvh';
import { solidDefaults } from './solidParameters.js';
import { projectionFrame } from './eyeProjection.js';

function projectedCutter(outer, outerBVH, cavityBVH, placement, thickness, api) {
  const { point, direction, up, width, height } = placement;
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite) ||
      !Array.isArray(direction) || direction.length !== 3 || !Array.isArray(up) || up.length !== 3 ||
      ![width, height].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid placed eye dimensions or projection.');
  const frame = projectionFrame(direction, up);
  const reach = outer.boundingBox.getSize(new THREE.Vector3()).length() * 2;
  const start = new THREE.Vector3(...point).addScaledVector(frame.direction, -reach);
  const ray = new THREE.Ray(start.clone(), frame.direction);
  let entry = 0, exit = Infinity;
  for (const radius of [0, 0.25, 0.5, 0.75, 1]) for (let i = 0; i < (radius ? 96 : 1); i++) {
    const theta = i / 96 * 2 * Math.PI;
    ray.origin.copy(start).addScaledVector(frame.right, radius * width / 2 * Math.cos(theta)).addScaledVector(frame.up, radius * height / 2 * Math.sin(theta));
    const surface = outerBVH.raycastFirst(ray, THREE.DoubleSide);
    const hits = cavityBVH.raycast(ray, THREE.DoubleSide).sort((a, b) => a.distance - b.distance);
    const enter = hits.find(h => h.face.normal.dot(ray.direction) < -1e-6);
    const leave = enter && hits.find(h => h.distance > enter.distance + 1e-5 && h.face.normal.dot(ray.direction) > 1e-6);
    if (!surface || !enter || !leave || surface.distance >= enter.distance || surface.face.normal.dot(ray.direction) >= 0) throw new Error('The eye does not fully reach the hollow interior here. Move it, reduce its size, or reduce wall thickness.');
    entry = Math.max(entry, enter.distance); exit = Math.min(exit, leave.distance);
  }
  if (exit - entry < Math.max(0.05, thickness * 0.05)) throw new Error('There is not enough interior depth for this eye. Move or shrink it.');
  const depth = entry + Math.min((exit - entry) * 0.3, thickness * 0.5);
  const cylinder = api.Manifold.cylinder(depth, width / 2, width / 2, 96);
  const scaled = cylinder.scale([1, height / width, 1]); cylinder.delete();
  // x=screen right, y=-screen up, z=cut direction form a right-handed basis.
  const transform = new THREE.Matrix4().makeBasis(frame.right, frame.up.clone().negate(), frame.direction).setPosition(start);
  let cutter;
  try { cutter = scaled.transform(transform.elements); }
  finally { scaled.delete(); }
  return { cutter, path: { start: start.toArray(), direction: ray.direction.toArray(), depth, entry, exit } };
}

function toManifold(geometry, api) {
  return new api.Manifold(new api.Mesh({
    numProp: 3,
    vertProperties: geometry.attributes.position.array,
    triVerts: Uint32Array.from(geometry.index.array)
  }));
}

function fromManifold(solid) {
  const mesh = solid.getMesh();
  // Manifold can have property seams. Weld only its explicit topological merges.
  const parent = Array.from({ length: mesh.vertProperties.length / mesh.numProp }, (_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < mesh.mergeFromVert.length; i++) parent[root(mesh.mergeFromVert[i])] = root(mesh.mergeToVert[i]);
  const ids = new Map(), positions = [], indices = [];
  for (const index of mesh.triVerts) {
    const canonical = root(index);
    if (!ids.has(canonical)) {
      ids.set(canonical, positions.length / 3);
      positions.push(...mesh.vertProperties.subarray(canonical * mesh.numProp, canonical * mesh.numProp + 3));
    }
    indices.push(ids.get(canonical));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}

// Level-set saddles can have separate topological fans that meet at an identical
// position. STL cannot preserve that distinction. Separate just those fans by
// a micron toward their own one-ring centroid, before performing any booleans.
function separateTouchingFans(geometry, separation) {
  const p = geometry.attributes.position, groups = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    const group = groups.get(key) || []; group.push(i); groups.set(key, group);
  }
  const duplicates = [...groups.values()].filter(group => group.length > 1).flat();
  if (!duplicates.length) return false;
  const neighbors = new Map(duplicates.map(i => [i, new Set()]));
  for (let i = 0; i < geometry.index.count; i += 3) {
    const triangle = [0, 1, 2].map(k => geometry.index.getX(i + k));
    for (const v of triangle) if (neighbors.has(v)) for (const n of triangle) if (n !== v) neighbors.get(v).add(n);
  }
  const changes = duplicates.map(i => {
    const origin = new THREE.Vector3().fromBufferAttribute(p, i), average = new THREE.Vector3();
    for (const n of neighbors.get(i)) average.add(new THREE.Vector3().fromBufferAttribute(p, n));
    average.divideScalar(neighbors.get(i).size).sub(origin);
    return [i, origin.add(average.normalize().multiplyScalar(separation))];
  });
  for (const [i, position] of changes) p.setXYZ(i, position.x, position.y, position.z);
  return true;
}

// Subtract a Euclidean-distance inset, not a scaled copy of the outside.
// The original outside remains exact; only the cavity is sampled on a grid.
function makeCavity(outer, params, api) {
  const { wallThickness: thickness, openBottom } = params;
  const box = outer.boundingBox, size = box.getSize(new THREE.Vector3());
  if (thickness * 2 >= Math.min(size.x, size.y) || thickness * (openBottom ? 1 : 2) >= size.z) throw new Error('The wall thickness leaves no hollow interior. Reduce thickness.');
  const edge = Math.min(thickness * 0.65, Math.max(size.x, size.y, size.z) / 55);
  const gridCells = (size.x + edge * 4) * (size.y + edge * 4) * (size.z + edge * 4) / edge ** 3;
  if (gridCells > 1800000) throw new Error('This wall thickness is too fine for the model size. Increase thickness or use a smaller source model.');
  const closed = outer.clone();
  const boundary = outer.clone();
  if (openBottom) {
    const indices = [], p = outer.attributes.position;
    for (let i = 0; i < outer.index.count; i += 3) {
      const triangle = [0, 1, 2].map(k => outer.index.getX(i + k));
      if (!triangle.every(v => p.getZ(v) === 0)) indices.push(...triangle);
    }
    boundary.setIndex(indices);
  }
  const insideBVH = new MeshBVH(closed), distanceBVH = new MeshBVH(boundary);
  const point = new THREE.Vector3(), ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.231, 0.417, 0.879).normalize());
  const nearest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const padding = edge * 2;
  const sdf = ([x, y, z]) => {
    point.set(x, y, openBottom ? Math.max(z, size.z * 1e-7) : z);
    // Sign from the first oriented boundary hit works for concave folds too.
    ray.origin.copy(point);
    const hit = insideBVH.raycastFirst(ray, THREE.DoubleSide);
    const inside = hit && hit.face.normal.dot(ray.direction) > 0;
    const found = distanceBVH.closestPointToPoint(point, nearest, 0, thickness + padding);
    const distance = found ? found.distance : thickness + padding;
    const value = (inside ? distance : -distance) - thickness;
    return openBottom ? Math.min(value, z + padding * 0.5) : value;
  };
  try {
    let cavity = api.Manifold.levelSet(sdf, {
      min: [box.min.x - padding, box.min.y - padding, openBottom ? -padding : -edge],
      max: [box.max.x + padding, box.max.y + padding, box.max.z + padding]
    }, edge);
    if (cavity.isEmpty()) { cavity.delete(); throw new Error('The wall thickness leaves no hollow interior. Reduce thickness.'); }
    const cavityMesh = fromManifold(cavity);
    try {
      if (separateTouchingFans(cavityMesh, Math.max(size.length() * 1e-5, 0.001))) {
        const repaired = toManifold(cavityMesh, api); cavity.delete(); cavity = repaired;
      }
    } catch (error) { cavity.delete(); throw error; }
    finally { cavityMesh.dispose(); }
    return { cavity, resolution: edge };
  } finally { closed.dispose(); boundary.dispose(); }
}

function eyeCutters(outer, cavityGeometry, p, api) {
  const height = outer.boundingBox.max.z;
  const width = p.eyeWidth, eyeHeight = p.eyeShape === 'round' ? width : p.eyeHeight;
  const z = height * p.eyeLevel;
  if (z - eyeHeight / 2 <= p.wallThickness || z + eyeHeight / 2 >= height - p.wallThickness) throw new Error('Move the eyes away from the top and bottom, or reduce their height.');
  if (p.eyeSpacing <= width + Math.max(0.5, p.wallThickness * 0.5)) throw new Error('Increase eye spacing or reduce eye width to leave a bridge between the eyes.');
  const a = THREE.MathUtils.degToRad(p.eyeAngle);
  const tangent = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
  const outward = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0);
  const rings = outer.userData.sampled;
  // Follow the envelope's center at the eye height (asymmetric sources included).
  let center = outer.boundingBox.getCenter(new THREE.Vector3());
  if (rings?.length) {
    const upper = rings.findIndex(r => r.z >= z);
    const next = rings[upper < 0 ? rings.length - 1 : upper];
    const prev = rings[Math.max(0, upper - 1)];
    const f = next.z === prev.z ? 0 : THREE.MathUtils.clamp((z - prev.z) / (next.z - prev.z), 0, 1);
    center.set(THREE.MathUtils.lerp(prev.cx, next.cx, f), THREE.MathUtils.lerp(prev.cy, next.cy, f), z);
  }
  center.z = z;
  const cavityBVH = new MeshBVH(cavityGeometry, { indirect: true });
  const outerBVH = new MeshBVH(outer, { indirect: true });
  const cutters = [], paths = [];
  try {
    for (const side of [-1, 1]) {
      const cut = projectedCutter(outer, outerBVH, cavityBVH, {
        point: center.clone().addScaledVector(tangent, side * p.eyeSpacing / 2).toArray(),
        direction: outward.clone().negate().toArray(), up: [0, 0, 1], width, height: eyeHeight
      }, p.wallThickness, api);
      cutters.push(cut.cutter); paths.push(cut.path);
    }
    return { cutters, paths };
  } catch (error) { cutters.forEach(c => c.delete()); throw error; }
}

function placedEyeCutters(outer, cavityGeometry, p, api) {
  if (!Array.isArray(p.placedEyes)) throw new Error('Invalid placed eyes.');
  const cavityBVH = new MeshBVH(cavityGeometry, { indirect: true });
  const outerBVH = new MeshBVH(outer, { indirect: true });
  const cutters = [], paths = [];
  try {
    p.placedEyes.forEach((eye, i) => {
      try {
        const cut = projectedCutter(outer, outerBVH, cavityBVH, eye, p.wallThickness, api);
        cutters.push(cut.cutter); paths.push(cut.path);
      } catch (error) { throw new Error(`Eye ${i + 1}: ${error.message} Remove this eye or undo the last placement.`); }
    });
    return { cutters, paths };
  } catch (error) { cutters.forEach(c => c.delete()); throw error; }
}

export async function createSolidProcessor(moduleOptions = {}) {
  const api = await Module(moduleOptions); api.setup();
  let cache;
  function clear() {
    if (cache) { cache.cavity.delete(); cache.shell.delete(); cache.cavityGeometry.dispose(); cache = undefined; }
  }
  return {
    clear,
    process(outer, parameters = {}) {
      const p = { ...solidDefaults, ...parameters };
      if (!p.hollow) {
        if (p.eyes) throw new Error('Enable a hollow interior before adding eye holes.');
        return outer.clone();
      }
      if (!Number.isFinite(p.wallThickness) || p.wallThickness < 0.4 || p.wallThickness > 30) throw new Error('Wall thickness must be between 0.4 and 30 mm.');
      if (!['paired', 'placed'].includes(p.eyeMode)) throw new Error('Invalid eye placement mode.');
      if (p.eyes && p.eyeMode === 'paired' && (!['round', 'oval'].includes(p.eyeShape) || ![p.eyeWidth, p.eyeHeight, p.eyeSpacing].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(p.eyeLevel) || p.eyeLevel <= 0 || p.eyeLevel >= 1 || !Number.isFinite(p.eyeAngle))) throw new Error('Enter valid eye dimensions and position.');
      const key = `${p.wallThickness}:${p.openBottom}`;
      if (!cache || cache.outer !== outer || cache.key !== key) {
        clear();
        const exterior = toManifold(outer, api);
        let cavity, shell, cavityGeometry;
        try {
          const inner = makeCavity(outer, p, api); cavity = inner.cavity;
          shell = exterior.subtract(cavity);
          if (shell.isEmpty() || shell.volume() >= exterior.volume() * 0.999) throw new Error('No usable interior remains. Reduce wall thickness.');
          cavityGeometry = fromManifold(cavity);
          cache = { outer, key, cavity, shell, cavityGeometry, resolution: inner.resolution };
        } catch (error) { cavity?.delete(); shell?.delete(); cavityGeometry?.dispose(); throw error; }
        finally { exterior.delete(); }
      }
      let result = cache.shell, cutters = [], paths = [];
      try {
        if (p.eyes) {
          ({ cutters, paths } = (p.eyeMode === 'placed' ? placedEyeCutters : eyeCutters)(outer, cache.cavityGeometry, p, api));
          if (cutters.length) result = api.Manifold.difference([cache.shell, ...cutters]);
          if (result.isEmpty()) throw new Error('The eye holes removed the entire shell. Reduce their size.');
        }
        // Remove tiny Boolean slivers before Float32 STL serialization.
        const tolerance = Math.max(outer.boundingBox.max.z * 1e-6, 1e-5);
        const simplified = result.simplify(tolerance);
        let output;
        try { output = fromManifold(simplified); }
        finally { simplified.delete(); }
        output.userData = {
          ...outer.userData,
          contourPositions: outer.attributes.position.array.slice(0, outer.userData.ringCount * outer.userData.angularSamples * 3),
          hollow: true, openBottom: p.openBottom, wallThickness: p.wallThickness,
          eyes: p.eyes && paths.length > 0, eyeMode: p.eyeMode, eyeCount: paths.length, eyePaths: paths, cavityResolution: cache.resolution
        };
        return output;
      } finally { if (result !== cache.shell) result.delete(); cutters.forEach(c => c.delete()); }
    }
  };
}
