import * as THREE from 'three';
import { orientGeometry } from './meshUtils.js';
import { sampleContours, smoothContours } from './contourSampler.js';
import { generateSkirt } from './skirtGenerator.js';

export const defaults = { cutoff: 0.58, clearance: 2.5, smoothing: 0.65, bottomSpread: 0.4, skirtHeight: null, foldCount: 7, foldDepth: 4, foldIrregularity: 0.2, asymmetry: 0.15, angularSamples: 128, verticalSamples: 60 };

export function generateGhost(source, transform = new THREE.Matrix4(), parameters = {}) {
  const p = { ...defaults, ...parameters };
  for (const key of ['cutoff', 'smoothing', 'bottomSpread', 'foldIrregularity', 'asymmetry']) if (!Number.isFinite(p[key]) || p[key] < 0 || p[key] > 1) throw new Error(`Invalid ${key}.`);
  if (![p.clearance, p.foldDepth].every(v => Number.isFinite(v) && v >= 0) || !Number.isInteger(p.foldCount) || p.foldCount < 3 || p.foldCount > 16) throw new Error('Invalid clearance or folds.');
  if (!Number.isInteger(p.angularSamples) || p.angularSamples < 32 || p.angularSamples > 256 || !Number.isInteger(p.verticalSamples) || p.verticalSamples < 4 || p.verticalSamples > 160) throw new Error('Invalid sample resolution.');
  if (p.skirtHeight !== null && (!Number.isFinite(p.skirtHeight) || p.skirtHeight <= 0)) throw new Error('Skirt height must be positive.');
  const geometry = orientGeometry(source, transform);
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  if (size.z < 0.00001 || Math.max(size.x, size.y) < 0.00001) { geometry.dispose(); throw new Error('The model needs non-zero height and width.'); }
  const scale = Math.max(size.x, size.y) / 2;
  let sampled;
  try { sampled = sampleContours(geometry, p.cutoff, p.verticalSamples, p.angularSamples); }
  finally { geometry.dispose(); }
  const upper = smoothContours(sampled, p.smoothing, p.clearance);
  const skirtHeight = p.skirtHeight ?? Math.max(upper[0].z, size.z * 0.08, 0.1);
  const shift = skirtHeight - upper[0].z;
  for (const ring of upper) ring.z += shift;
  const rings = [...generateSkirt(upper[0], p, skirtHeight, scale), ...upper];
  const last = rings.at(-1), capLayers = 14;
  const capHeight = Math.max(p.clearance, Math.max(...last.radii) * 0.45, size.z * 0.025);
  // Quarter ellipse: vertical tangent at the shoulder and horizontal at the apex.
  for (let l = 1; l < capLayers; l++) {
    const a = l / capLayers * Math.PI / 2;
    rings.push({ z: last.z + capHeight * Math.sin(a), cx: last.cx, cy: last.cy, radii: last.radii.map(r => r * Math.cos(a)) });
  }
  const vertices = [], faces = [], n = p.angularSamples;
  for (const ring of rings) for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    vertices.push(ring.cx + ring.radii[i] * Math.cos(a), ring.cy + ring.radii[i] * Math.sin(a), ring.z);
  }
  for (let l = 0; l < rings.length - 1; l++) for (let i = 0; i < n; i++) {
    const a = l * n + i, b = l * n + (i + 1) % n, c = a + n, d = b + n;
    faces.push(a, b, c, b, d, c);
  }
  const bottom = vertices.length / 3;
  vertices.push(rings[0].cx, rings[0].cy, 0);
  const top = vertices.length / 3;
  vertices.push(last.cx, last.cy, last.z + capHeight);
  const finalOffset = (rings.length - 1) * n;
  for (let i = 0; i < n; i++) {
    faces.push(bottom, (i + 1) % n, i);
    faces.push(finalOffset + i, finalOffset + (i + 1) % n, top);
  }
  const output = new THREE.BufferGeometry();
  output.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  output.setIndex(faces); output.computeVertexNormals(); output.computeBoundingBox();
  output.userData.sampled = sampled.map(c => ({ ...c, z: c.z + shift }));
  output.userData.ringCount = rings.length; output.userData.angularSamples = n;
  return output;
}
