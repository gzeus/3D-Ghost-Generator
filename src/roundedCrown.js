// Replace the final source sections with one broad crown rather than appending
// a second, small dome to the already tapering tip. A squared-radius ellipse
// stays concave toward the apex, so its slope never resets into a raised button.
export function roundedCrown(upper, sourceTop, sourceHeight, clearance) {
  const joinIndex = Math.max(1, Math.floor((upper.length - 1) * 0.72));
  const join = upper[joinIndex], previous = upper[joinIndex - 1];
  const mean = radii => radii.reduce((sum, r) => sum + r, 0) / radii.length;
  const radius = mean(join.radii);
  const top = Math.max(sourceTop + clearance, join.z + radius * 0.65, join.z + sourceHeight * 0.03);
  const height = top - join.z;
  const slope = (radius - mean(previous.radii)) / (join.z - previous.z);
  const tangent = Math.max(-0.9, Math.min(0, 2 * slope * height / radius));
  const profile = t => Math.sqrt(Math.max(0, 1 + tangent * t - (1 + tangent) * t * t));
  let blendStart = joinIndex;
  while (blendStart > 0 && upper[blendStart - 1].z >= join.z - height * 0.4) blendStart--;
  const startZ = upper[blendStart].z;
  const rings = upper.slice(0, joinIndex + 1).map((ring, i) => {
    if (i < blendStart) return ring;
    const t = join.z === startZ ? 1 : (ring.z - startZ) / (join.z - startZ);
    const weight = t * t * (3 - 2 * t);
    const factor = profile((ring.z - join.z) / height);
    return { z: ring.z, cx: ring.cx * (1 - weight) + join.cx * weight, cy: ring.cy * (1 - weight) + join.cy * weight,
      radii: ring.radii.map((r, a) => r * (1 - weight) + join.radii[a] * factor * weight) };
  });
  const layers = 28;
  for (let i = 1; i < layers; i++) {
    const t = Math.sin(i / layers * Math.PI / 2);
    rings.push({ z: join.z + height * t, cx: join.cx, cy: join.cy, radii: join.radii.map(r => r * profile(t)) });
  }
  return { rings, apex: [join.cx, join.cy, top], joinZ: join.z };
}
