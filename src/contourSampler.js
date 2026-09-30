// Horizontal triangle intersections -> convex outer sections -> radial contours.
// Convex sections deliberately bridge disconnected parts and discard small recesses.
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function hull(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (unique.length < 3) return unique;
  const lo = [], hi = [];
  for (const p of unique) { while (lo.length > 1 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (let i = unique.length - 1; i >= 0; i--) { const p = unique[i]; while (hi.length > 1 && cross(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

export function sampleContours(geometry, cutoff, layers, angles) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, height = box.max.z;
  const start = height * Math.min(cutoff, 0.995);
  const end = height - Math.max(height * 0.0001, 0.000001);
  const step = (end - start) / (layers - 1);
  const sections = Array.from({ length: layers }, () => []);
  const pos = geometry.attributes.position, index = geometry.index;
  const count = index ? index.count : pos.count;
  for (let t = 0; t < count; t += 3) {
    const ids = [0, 1, 2].map(k => index ? index.getX(t + k) : t + k);
    const vs = ids.map(i => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const zMin = Math.min(...vs.map(v => v[2])), zMax = Math.max(...vs.map(v => v[2]));
    const first = Math.max(0, Math.ceil((zMin - start) / step));
    const last = Math.min(layers - 1, Math.floor((zMax - start) / step));
    for (let l = first; l <= last; l++) {
      const z = start + l * step;
      for (let e = 0; e < 3; e++) {
        const a = vs[e], b = vs[(e + 1) % 3];
        if ((a[2] <= z && b[2] > z) || (b[2] <= z && a[2] > z)) {
          const f = (z - a[2]) / (b[2] - a[2]);
          sections[l].push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        }
      }
    }
  }
  const minimum = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, height) * 0.0001;
  const contours = sections.map((points, l) => {
    if (!points.length) return null;
    const polygon = hull(points);
    const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
    const cy = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
    const radii = Array.from({ length: angles }, (_, i) => {
      const dx = Math.cos(i * 2 * Math.PI / angles), dy = Math.sin(i * 2 * Math.PI / angles);
      let radius = minimum;
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j], b = polygon[(j + 1) % polygon.length];
        const ax = a[0] - cx, ay = a[1] - cy, ex = b[0] - a[0], ey = b[1] - a[1];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const r = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
        if (r >= 0 && u >= -1e-8 && u <= 1 + 1e-8) radius = Math.max(radius, r);
      }
      return radius;
    });
    return { z: start + l * step, cx, cy, radii };
  });
  if (contours.every(c => !c)) throw new Error('No usable sections found. Try a lower cutoff or a different orientation.');
  // Interpolate empty height bands (including disconnected components).
  for (let l = 0; l < layers; l++) {
    if (contours[l]) continue;
    let a = l - 1, b = l + 1;
    while (a >= 0 && !contours[a]) a--;
    while (b < layers && !contours[b]) b++;
    const left = contours[a] || contours[b], right = contours[b] || left;
    const f = a < 0 || b >= layers ? 0 : (l - a) / (b - a);
    contours[l] = { z: start + l * step, cx: left.cx * (1 - f) + right.cx * f, cy: left.cy * (1 - f) + right.cy * f, radii: left.radii.map((r, i) => r * (1 - f) + right.radii[i] * f) };
  }
  return contours;
}

export function smoothContours(contours, smoothing, clearance) {
  let result = contours.map(c => ({ ...c, radii: [...c.radii] }));
  for (let pass = 0; pass < Math.round(smoothing * 36); pass++) {
    result = result.map((c, l) => {
      const prev = result[Math.max(0, l - 1)], next = result[Math.min(result.length - 1, l + 1)], n = c.radii.length;
      return { z: c.z, cx: c.cx * 0.6 + (prev.cx + next.cx) * 0.2, cy: c.cy * 0.6 + (prev.cy + next.cy) * 0.2,
        radii: c.radii.map((r, i) => r * 0.4 + (c.radii[(i + n - 1) % n] + c.radii[(i + 1) % n]) * 0.2 + (prev.radii[i] + next.radii[i]) * 0.1) };
    });
  }
  return result.map(c => ({ ...c, radii: c.radii.map(r => r + clearance) }));
}
