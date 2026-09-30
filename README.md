# Sheet / Ghost Studio

A small, browser-only modelling utility that turns an STL into a solid sheet ghost. Built with Vite, vanilla JavaScript and Three.js. No cloth physics, accounts, remote processing or file uploads. Runtime assets are bundled locally; the app does not load fonts or scripts from a CDN.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. On Windows PowerShell with script restrictions, use `npm.cmd` in place of `npm`. `npm run build` creates `dist/`; `npm run preview` serves that build. Serve the app over HTTP rather than opening `index.html` directly, because it uses ES modules and a Web Worker.

## Workflow

The rabbit example loads immediately. Drop an STL or browse for one, then use the Source or Overlay view to orient it with X/Y/Z rotations. The model is centered in XY and placed on Z=0 after each orientation change. STL units are assumed to be millimetres.

“Use source above” is a height percentage: 58% uses the upper 42% of the model. The mint plane marks this height; geometry below it is dimmed in the source preview. Adjust clearance and smoothing, then spread, skirt height, folds and asymmetry. Leaving skirt height blank uses the cutoff height automatically. Controls regenerate after a 200 ms debounce. Export is disabled while the settings are awaiting a valid result.

Export writes only the generated solid as binary `originalname_ghost.stl`. The developer view exposes raw section points, generated rings, cutoff plane, bounding box and wireframe.

## Geometry algorithm

1. Clone and transform the source, center it in XY and ground it at Z=0.
2. Intersect triangles with 60 horizontal planes above the cutoff. Each triangle is tested only against planes within its Z bounds.
3. Calculate a convex hull of each horizontal section, including disconnected components. Cast 128 evenly spaced 2D radial rays from each section's center against that hull. Fill missing height bands by interpolation.
4. Smooth radii circumferentially and vertically, smooth section centers, and add clearance in millimetres. This intentionally removes cavities and small detail to produce a loose envelope.
5. **The first smoothed upper contour is the skirt transition.** `skirtGenerator.js` extends that contour downward with 36 rings. Below this join, it never consults the source. Spread grows as `t^1.5`; fold strength uses a smoothstep. Periodic, deterministic phase and amplitude modulation introduce irregularity and asymmetry without a seam or per-vertex noise.
6. Close the top with 14 shrinking elliptical rings and one apex. Close the exact Z=0 bottom ring with a consistently wound triangle fan. Positive radii and increasing ring heights keep the cross sections simple and the surface free of folds crossing themselves.
7. Recalculate normals and validate finite vertices, nonzero triangle areas, two opposite uses of every edge, positive signed volume, and a grounded base. Only validated meshes become exportable.

STL parsing, generation and validation run in a dedicated Web Worker. Requests are coalesced and stale results discarded, keeping the UI responsive while it computes. Source geometry stays in the worker between updates.

## Structure and tuning

- `src/ghostGenerator.js`: public `generateGhost(sourceBufferGeometry, transformMatrix, parameters)` API; defaults, ring assembly and rounded top.
- `src/contourSampler.js`: triangle slicing, convex sections, interpolation and smoothing. Change the `36` smoothing pass multiplier to alter smoothing strength.
- `src/skirtGenerator.js`: nonlinear spread, deterministic fold modulation and radius safety floor. Change the `0.75` spread multiplier or ring count here.
- `src/meshUtils.js`: orientation and solid validation.
- `src/generation.worker.js`: STL processing and background generation.
- `src/viewer.js`: Z-up Three.js viewport, source clipping, diagnostics and OrbitControls.
- `src/main.js` and `src/ui.js`: state, input handling and UI.

The easiest code parameters to tune are `angularSamples` (128), `verticalSamples` (60), smoothing passes, skirt ring count (36) and cap layers (14). Clearance and fold depth are absolute millimetres. `bottomSpread`, smoothing, irregularity and asymmetry are normalized 0–1; fold count is an integer. `skirtHeight: null` uses the cutoff height, with a minimum of 8% of source height to preserve a skirt when cutoff is zero.

## Limitations

- This is a stylized, convex horizontal envelope, not a physical drape or exact offset. Smoothing can move the surface inside parts of the original. It is not a fitted hollow cover; the exported shape is a filled solid.
- Each height has one contour and the top has one rounded closure. Separate ears/horns are bridged; narrow features can be softened away. Strongly concave, sideways or branching models may lose recognizability.
- At 100% cutoff the algorithm uses a thin band at 99.5% height. Perfectly flat inputs are rejected; nearly flat ones trigger a warning. Very small models may need lower clearance/fold depth.
- Larger meshes can take seconds and considerable memory. Files are limited to 120 MB and 2 million triangles. The worker prevents UI blocking, but there is no BVH, decimation or progress estimate yet.
- Arbitrarily corrupt or adversarial STL data is not repaired. This app validates generated topology, not all source mesh defects or printer-specific constraints.
- Extreme folds on small models clamp inward radii to avoid self-intersections; reduce fold depth if the skirt looks pinched. Very high cutoffs can create densely spaced triangles.
- Topology and STL round trips are covered by automated tests. Actual printing, support requirements, and PrusaSlicer inspection still require a human check for the chosen model/printer.

## Verification

```sh
npm test
npm run build
```

Tests cover deterministic generation, manifold edge incidence and winding, zero-area triangles, exact bottom planarity, binary STL export/import, orientation, disconnected source sections, parameter extremes and invalid inputs.

With the dev server running, `npm run test:browser` runs a real Chrome smoke test for upload, orientation, live changes, export, invalid file recovery and mobile layout. It defaults to the Windows Chrome installation; set `CHROME_PATH` for another installation and `APP_URL` for a different server URL. Screenshots and downloaded fixtures go into the ignored `artifacts/` folder.
