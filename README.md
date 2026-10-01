# Sheet / Ghost Studio

A small, browser-only modelling utility that turns an STL, OBJ, or 3MF model into a solid or hollow sheet ghost with optional see-through eyes. Built with Vite, vanilla JavaScript, Three.js, and a locally bundled Manifold WASM boolean engine. No cloth physics, accounts, remote processing or file uploads. Runtime assets are bundled locally; the app does not load fonts or scripts from a CDN.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. On Windows PowerShell with script restrictions, use `npm.cmd` in place of `npm`. `npm run build` creates `dist/`; `npm run preview` serves that build. Serve the app over HTTP rather than opening `index.html` directly, because it uses ES modules and a Web Worker.

## Workflow

The rabbit example loads immediately. Drop an STL, OBJ, or 3MF file or browse for one, then use the Source or Overlay view to orient it with X/Y/Z rotations. The model is centered in XY and placed on Z=0 after each orientation change. STL and OBJ units are assumed to be millimetres; 3MF's declared units are converted to millimetres.

Set **Target size — height** in Source to uniformly scale the model to a chosen **Z-axis height** in millimetres, measured after orientation. X/Y widths do not determine the scale, and all three axes retain their proportions. Rotating with a target height set recomputes the uniform scale so Z still matches the target. Leave it blank or click **Original size** to restore the imported scale; a new upload resets it. The source dimensions, cutoff plane, and generated ghost use the same scale, and the camera refits after resizing. Clearance, wall thickness, eye dimensions, and fold depth remain absolute millimetres; the final ghost can be taller than the source target. Existing click-placed eyes retain scene coordinates, so resizing after placement may require repositioning them.

OBJ import combines polygon meshes from all objects/groups, including triangulated polygon faces and negative indices. MTL files and textures are unnecessary. 3MF import reads the printable root build, component assemblies, transforms, and embedded production-extension model parts; unused object resources and non-printable build items are excluded. It imports geometry only, ignoring colors, textures and slicer settings. The 3MF reader runs in the worker without browser DOM APIs or external resource requests. Supported geometry follows the [3MF core model/build structure](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) and [embedded production component references](https://github.com/3MFConsortium/spec_production/blob/master/3MF%20Production%20Extension.md).

“Use source above” is a height percentage: 58% uses the upper 42% of the model. The mint plane marks this height; geometry below it is dimmed in the source preview. Adjust clearance and smoothing, then spread, skirt height, folds and asymmetry. Leaving skirt height blank uses the cutoff height automatically. Controls regenerate after a 200 ms debounce. Export is disabled while the settings are awaiting a valid result.

**Top smoothing** controls how closely the upper part follows the source independently of general **Sheet smoothing**. At **0% / Follow contours**, upper contour detail is restored and only the very tip is rounded closed. At **100% / Rounded crown**, the broad smooth crown replaces more of the top. The default is **35%** to retain more protruding details. Lower settings also reduce the effect of general smoothing near the tip, so a smooth body can retain a more detailed top. The crown transition moves continuously as the slider changes; the skirt is unaffected. This still uses one contour per height, so disconnected tips are bridged rather than reproduced as separate cloth peaks.

Export writes only the generated solid as binary `originalname_ghost.stl`. The developer view exposes raw section points, generated rings, cutoff plane, bounding box and wireframe.

### Hollow interior and eyes

In **Hollow & eyes**, enable **Hollow interior** and enter the wall thickness in millimetres (default 2 mm). **Open underside** is on by default: the inner and outer surfaces join at a planar bottom rim. Turn it off to keep a floor with the same nominal thickness as the walls. Both modes export a closed, manifold boundary of the printable material; an open underside is not an unconnected mesh edge.

**Add see-through eyes** automatically enables hollowing. Choose round eyes (diameter) or oval eyes (width and height), adjust center-to-center spacing, height as a percentage of the finished ghost, and face direction. At 0° the face points toward −Y; 90° faces +X. The holes open only the front wall into the cavity. If an opening cannot fit fully over the cavity without reaching the rear wall, generation stops with adjustment guidance and export stays disabled. Turning off hollowing also turns off eyes.

Enable **Place eyes by clicking** to switch from the original symmetric pair to free placement. Set the shape and size for the next eye, orbit to the desired view, and click the ghost. A cursor outline previews the brush. Each click projects a circular/oval bore along that click's camera ray, with the oval aligned to the screen. Its dimensions are millimetres in the plane perpendicular to that ray; a sloping surface can stretch the visible opening. There is no fixed limit on the number of eyes, and each retains its own size and direction when the camera or brush settings change.

Drag to orbit as usual; right-drag pans and scrolling zooms. Clicks on empty space or through an existing opening do nothing. Placement pauses during regeneration, and works in Ghost or Overlay view. Use **Undo last**, **Clear all**, or each eye's **Remove** button to edit the list. Switching the toggle off restores the original pair and keeps the placed-eye list for when you switch back. Loading a new source clears it. Placements are stored in scene coordinates, so changing the underlying ghost shape may require removing/replacing an eye that no longer fits.

## Geometry algorithm

1. Clone and transform the source, center it in XY and ground it at Z=0.
2. Intersect triangles with 60 horizontal planes above the cutoff. Each triangle is tested only against planes within its Z bounds.
3. Calculate a convex hull of each horizontal section, including disconnected components. Cast 128 evenly spaced 2D radial rays from each section's center against that hull. Fill missing height bands by interpolation.
4. Smooth radii circumferentially and vertically, smooth section centers, and add clearance in millimetres. This intentionally removes cavities and small detail to produce a loose envelope.
5. **The first smoothed upper contour is the skirt transition.** `skirtGenerator.js` extends that contour downward with 36 rings. Below this join, it never consults the source. Spread grows as `t^1.5`; fold strength uses a smoothstep. Periodic, deterministic phase and amplitude modulation introduce irregularity and asymmetry without a seam or per-vertex noise.
6. Form a rounded closure with a user-controlled transition. Low `topSmoothing` restores detail in the upper contour band and moves the crown join toward the very tip; high values retain general smoothing and use a broader replacement. The join is interpolated between sampled sections so it does not snap between layers. Blend below the join, then use 28 elliptical profile steps with continuously narrowing radii and a horizontal tangent at the apex. Close the exact Z=0 bottom ring with a consistently wound triangle fan. Positive radii and increasing ring heights keep the cross sections simple and the surface free of folds crossing themselves.
7. Optionally generate an inner cavity from a signed Euclidean-distance field of the outer surface, accelerated with `three-mesh-bvh`. Manifold's level-set mesher approximates the inset in real millimetres. For an open bottom, distance measurements exclude the original floor and the cavity extends below Z=0. For a closed floor, the distance field includes the floor.
8. Subtract the cavity with Manifold. Subtract 96-sided circular or elliptical cylinder cutters for the eyes. Sample the cavity across each opening to find a cut depth inside it, preserving the rear wall. The outer shape and cavity are cached separately, so eye adjustments reuse the cavity. Coincident inner-surface vertex fans are separated at micron scale before booleans to avoid STL weld pinches; tiny boolean slivers are simplified before export.
9. Recalculate normals and validate finite and distinct vertex positions, nonzero triangle areas, two opposite uses of every edge, positive signed volume, and a grounded base. Only validated meshes become exportable. The preview uses separate creased normals so eye rims look crisp without changing the export topology.

Model parsing, generation and validation run in a dedicated Web Worker. Requests are coalesced and stale results discarded, keeping the UI responsive while it computes. Source geometry stays in the worker between updates.

## Structure and tuning

- `src/ghostGenerator.js`: public `generateGhost(sourceBufferGeometry, transformMatrix, parameters)` API; defaults, ring assembly and rounded top.
- `src/contourSampler.js`: triangle slicing, convex sections, interpolation and smoothing. Change the `36` smoothing pass multiplier to alter smoothing strength.
- `src/skirtGenerator.js`: nonlinear spread, deterministic fold modulation and radius safety floor. Change the `0.75` spread multiplier or ring count here.
- `src/roundedCrown.js`: adjustable crown replacement, continuously interpolated join height, elliptical taper and apex sampling. `topSmoothing` is normalized 0–1, default 0.35.
- `src/meshUtils.js`: orientation and solid validation.
- `src/solidProcessor.js`: async `createSolidProcessor()` initializes Manifold; its `process(outerGeometry, parameters)` returns a new hollow/eye-cut geometry. Call `clear()` to release cached WASM solids. Distance-grid spacing and its allocation guard live here.
- `src/solidParameters.js`: hollow and eye defaults, separate from envelope generation parameters.
- `src/eyeProjection.js`: serializable world-space eye frames and per-click shape/size snapshots.
- `src/eyePlacementTool.js`: accelerated scene picking, brush outline, and click-versus-drag handling. `eyeMode: 'placed'` uses the `placedEyes` array of `{point, direction, up, shape, width, height}`; `'paired'` keeps the original slider controls.
- `src/modelImport.js`: STL/OBJ/3MF dispatch and common mesh normalization.
- `src/threeMFImport.js`: worker-safe ZIP/XML mesh and assembly reader, unit conversion, and embedded-part resolution.
- `src/generation.worker.js`: model processing and background generation.
- `src/viewer.js`: Z-up Three.js viewport, source clipping, diagnostics and OrbitControls.
- `src/main.js` and `src/ui.js`: state, input handling and UI.

The easiest code parameters to tune are `angularSamples` (128), `verticalSamples` (60), smoothing passes, skirt ring count (36) and crown layers (28). `targetSize: null` preserves the source size; a positive value sets its oriented Z height in mm. Clearance and fold depth are absolute millimetres. `bottomSpread`, smoothing, irregularity and asymmetry are normalized 0–1; fold count is an integer. `skirtHeight: null` uses the cutoff height, with a minimum of 8% of source height to preserve a skirt when cutoff is zero.

## Limitations

- This is a stylized, convex horizontal envelope, not a physical drape or a fitted cover for the source. Smoothing can move the surface inside parts of the original. Solid mode remains the default; hollow mode insets the generated ghost, not the uploaded source.
- Wall thickness is a nominal Euclidean inset, approximated by the cavity's triangle mesh. Curved regions and tight folds have small sampling deviations; narrow features can remain solid. Very thin walls on large models exceed a bounded sampling budget and produce an instruction to increase thickness instead of exhausting browser memory.
- Eyes are straight circular/elliptical bores, either a symmetric pair or individually projected from camera clicks. Large or grazing-angle holes near a thin roof, narrow neck, or folds may not fit; reduce their size, move them, or reduce wall thickness. A rejected click identifies the eye to undo/remove. The app does not automatically relocate invalid holes or silently create blind recesses. Overlapping cuts can merge into one opening; large placement counts increase boolean processing time.
- Each height has one contour and the top has one rounded closure. Separate ears/horns are bridged; narrow features can be softened away. Strongly concave, sideways or branching models may lose recognizability.
- At 100% cutoff the algorithm uses a thin band at 99.5% height. Perfectly flat inputs are rejected; nearly flat ones trigger a warning. Very small models may need lower clearance/fold depth.
- Larger meshes can take seconds and considerable memory. Files are limited to 120 MB and 2 million triangles. A BVH accelerates hollowing; source contour slicing still has no decimation. The worker keeps geometry processing off the main thread, but the first hollowing pass can take several seconds.
- Arbitrarily corrupt or adversarial STL data is not repaired. This app validates generated topology, not all source mesh defects or printer-specific constraints.
- OBJ must contain polygon faces; point clouds and lines are not mesh sources. 3MF must contain printable triangle meshes: toolpath-only, volumetric-only, encrypted, or externally referenced models are unsupported. Geometry/XML parts are limited to 256 MB decompressed and assembled geometry to 2 million triangles. Missing parts, invalid references, or circular assemblies fail with an error rather than silently importing a partial model. Export is STL for every source format.
- Extreme folds on small models clamp inward radii to avoid self-intersections; reduce fold depth if the skirt looks pinched. Very high cutoffs can create densely spaced triangles.
- Topology and STL round trips are covered by automated tests. Actual printing, support requirements, and PrusaSlicer inspection still require a human check for the chosen model/printer.

## Verification

```sh
npm test
npm run build
```

Tests cover deterministic generation, manifold edge incidence and winding, zero-area triangles, exact bottom planarity, binary STL export/import (including hollow folded models with eyes), orientation, disconnected source sections, parameter extremes and invalid inputs. Hollow tests measure wall/floor thickness, check open underside access, distinguish round from oval holes, and trace rays to confirm the eyes reach the cavity while the back remains intact. Placement tests cover zero, one, and seven independent openings, tilted camera rays, preserved per-eye dimensions, and actionable invalid-placement errors.

With the dev server running, `npm run test:browser` runs a real Chrome smoke test for upload, orientation, live changes, hollowing, both eye shapes, floor options, export, invalid file/eye recovery and mobile layout. It exercises real scene clicks, multiple eyes, brush settings, orbit/miss/opening filtering, switching placement modes, undo/remove/clear, and validates downloaded hollow and click-placed STLs. It defaults to the Windows Chrome installation; set `CHROME_PATH` for another installation and `APP_URL` for a different server URL. Screenshots and downloaded fixtures go into the ignored `artifacts/` folder.

Geometry API references: [Manifold](https://manifoldcad.org/docs/jsuser/classes/Manifold.html), [WASM initialization and memory management](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html), and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh).
