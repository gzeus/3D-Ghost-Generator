export function generateSkirt(join, params, height, scale) {
  const rings = [], count = 36, n = join.radii.length;
  for (let l = 0; l < count; l++) {
    const t = 1 - l / count;
    const influence = t * t * (3 - 2 * t);
    const drift = params.asymmetry * scale * 0.07 * influence;
    rings.push({ z: height * l / count, cx: join.cx + drift, cy: join.cy - drift * 0.4,
      radii: join.radii.map((r, i) => {
        const a = i * Math.PI * 2 / n;
        const phase = a * params.foldCount + 0.5 + params.foldIrregularity * 0.65 * Math.sin(a * 3 + 1.7);
        const wave = Math.sin(phase) * (1 + params.foldIrregularity * 0.3 * Math.sin(a * 2 + 0.9));
        const fold = params.foldDepth * influence * (wave + params.foldIrregularity * 0.18 * Math.sin(phase * 2 + 0.4));
        const spread = scale * params.bottomSpread * 0.75 * Math.pow(t, 1.5);
        const asymmetric = scale * params.asymmetry * 0.07 * Math.sin(a + 0.8) * influence;
        // Positive radius makes each horizontal section simple and the base fan valid.
        return Math.max(scale * 0.035, r + spread + fold + asymmetric);
      }) });
  }
  return rings;
}
