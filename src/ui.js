const slider = (key, label, min, max, value, unit = '%', step = 1) => `<label class="control" for="${key}"><span>${label}</span><output id="${key}-value">${value}${unit === '°' || unit === '%' ? '' : ' '}${unit}</output></label><input id="${key}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
const icon = `<svg viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M5 29V15a11 11 0 0 1 22 0v14l-5-3-6 4-6-4-5 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 14v3m8-3v3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
export function renderUI() {
  document.querySelector('#app').innerHTML = `
    <header class="app-header"><a class="brand" href="./">${icon}<span>sheet<span class="brand-dot">/</span><small>GHOST STUDIO</small></span></a><div class="header-note">A little shape. A little mystery.</div><span class="local-badge"><i></i> LOCAL BY DESIGN</span></header>
    <main>
      <aside class="sidebar">
        <div class="intro"><span class="eyebrow">FROM MESH TO MYSTERY</span><h1>Give it a sheet.</h1><p>Turn any STL into a ghost worth printing.</p></div>
        <section><div class="section-title"><h2><span>01</span> Source</h2><button class="text-button" id="demo">Try example ↗</button></div>
          <label class="upload" id="drop-zone" for="file"><span class="upload-icon">↥</span><strong>Drop your STL here</strong><span>or <u>browse files</u> · max. 120 MB</span><input id="file" type="file" accept=".stl" /></label>
          <div class="file-info"><span class="file-symbol">◇</span><div><strong id="filename">Rabbit example</strong><small id="source-details">Loading source…</small></div><span class="file-check">✓</span></div>
          <div class="label-row"><span>Orientation</span><button id="reset" class="text-button">Reset ↺</button></div>
          <div class="rotation-inputs">${['X', 'Y', 'Z'].map(axis => `<label><span>${axis}</span><input aria-label="${axis} rotation in degrees" id="rotate-${axis.toLowerCase()}" type="number" step="5" min="-360" max="360" value="0"/><span>°</span></label>`).join('')}</div>
        </section>
        <section><div class="section-title"><h2><span>02</span> Sheet</h2><span class="section-hint">THE UPPER SILHOUETTE</span></div>
          ${slider('cutoff', 'Use source above', 0, 100, 58)}<div class="range-hints"><span>Whole model</span><span>Top only</span></div>
          ${slider('clearance', 'Sheet clearance', 0, 10, 2.5, 'mm', 0.1)}
          ${slider('smoothing', 'Sheet smoothing', 0, 100, 65)}
        </section>
        <section><div class="section-title"><h2><span>03</span> Skirt</h2><span class="section-hint">LET IT HANG</span></div>
          ${slider('bottomSpread', 'Bottom spread', 0, 100, 40)}
          <label class="height-control" for="skirtHeight"><span>Skirt height <small>Auto from cutoff</small></span><span><input id="skirtHeight" type="number" min="0.1" step="1" placeholder="Auto" aria-label="Skirt height in millimetres, blank for automatic"/> mm</span></label>
          ${slider('foldCount', 'Fold count', 3, 16, 7, '')}
          ${slider('foldDepth', 'Fold depth', 0, 15, 4, 'mm', 0.1)}
          ${slider('foldIrregularity', 'Fold irregularity', 0, 100, 20)}
          ${slider('asymmetry', 'Asymmetry', 0, 100, 15)}
        </section>
        <section><div class="section-title"><h2><span>04</span> Hollow & eyes</h2><span class="section-hint">LET THE LIGHT IN</span></div>
          <label class="feature-toggle"><input id="hollow" type="checkbox"/> Hollow interior</label>
          <fieldset id="hollow-controls" disabled>
            <label class="dimension-control" for="wallThickness"><span>Wall thickness</span><span><input id="wallThickness" type="number" min="0.4" max="30" step="0.1" value="2"/> mm</span></label>
            <label class="feature-toggle"><input id="openBottom" type="checkbox" checked/> Open underside</label>
            <p class="control-help">Leave the bottom open, or keep a floor with the same thickness. The contact edge stays flat.</p>
          </fieldset>
          <label class="feature-toggle eye-toggle"><input id="eyes" type="checkbox"/> Add see-through eyes</label>
          <p class="control-help">Enables a hollow interior. Openings cut through the front wall into the cavity.</p>
          <fieldset id="eye-controls" disabled>
            <label class="feature-toggle"><input id="clickEyes" type="checkbox"/> Place eyes by clicking</label>
            <p class="control-help" id="placement-help" hidden>Choose a shape and size for the next eye, then click the ghost. Drag to orbit; each click uses the current camera direction. Existing eyes keep their own size.</p>
            <label class="dimension-control" for="eyeShape"><span>Eye shape</span><select id="eyeShape"><option value="oval">Oval</option><option value="round">Round</option></select></label>
            <label class="dimension-control" for="eyeWidth"><span id="eyeWidth-label">Eye width</span><span><input id="eyeWidth" type="number" min="0.5" max="100" step="0.5" value="6"/> mm</span></label>
            <label class="dimension-control" for="eyeHeight" id="eyeHeight-row"><span>Eye height</span><span><input id="eyeHeight" type="number" min="0.5" max="100" step="0.5" value="9"/> mm</span></label>
            <div id="paired-eye-controls"><label class="dimension-control" for="eyeSpacing"><span>Eye spacing <small>Center to center</small></span><span><input id="eyeSpacing" type="number" min="1" max="250" step="0.5" value="13"/> mm</span></label>
            ${slider('eyeLevel', 'Eye position · height', 10, 95, 65)}
            ${slider('eyeAngle', 'Face direction', -180, 180, 0, '°')}
            <p class="control-help">0° faces forward (−Y). Rotate the face around the ghost to choose another side.</p></div>
            <div id="placed-eye-controls" hidden><div class="placed-header"><span id="placed-eye-count" aria-live="polite">0 eyes placed</span><button id="undo-eye" type="button" class="text-button" disabled>Undo last</button><button id="clear-eyes" type="button" class="text-button" disabled>Clear all</button></div><ol id="placed-eye-list" aria-label="Placed eyes"></ol><p class="control-help">No fixed eye limit. Switch this toggle off to use the original pair; your placed eyes are kept. Loading a new source clears placements.</p></div>
          </fieldset>
        </section>
        <details class="debug"><summary>Developer view <span>+</span></summary><div>${[['points','Sampled contour points'],['rings','Generated contour rings'],['plane','Cutoff plane'],['box','Source bounding box'],['wireframe','Ghost wireframe']].map(([key, label]) => `<label><input type="checkbox" data-debug="${key}" ${key === 'plane' ? 'checked' : ''}>${label}</label>`).join('')}</div></details>
        <div class="output"><button id="generate" class="secondary-button">↻ Update ghost</button><button id="export" class="primary-button" disabled>↓ Export STL</button><p id="output-note">A closed solid. A flat base. Ready for your slicer.</p></div>
      </aside>
      <div class="workspace">
        <div class="viewport-top"><div><span class="eyebrow">THE WORKBENCH</span><h2>Your next friendly haunting.</h2></div><span class="version">PROCEDURAL / V1.0</span></div>
        <div class="view-toolbar"><div class="segmented" aria-label="Preview mode">${['ghost','source','overlay'].map(mode => `<button data-mode="${mode}" class="${mode === 'ghost' ? 'active' : ''}" aria-pressed="${mode === 'ghost'}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join('')}</div><button id="fit" class="fit-button">⛶ <span>Fit camera</span></button></div>
        <div id="viewport" aria-label="Interactive 3D preview"></div>
        <div id="placement-banner" class="placement-banner" hidden>Click the ghost to add an eye · Drag to orbit</div>
        <div class="viewport-caption"><span class="caption-mark">↳</span><div><strong id="model-caption">Soft folds. Solid inside.</strong><span>A procedural sheet, made for the real world.</span></div></div>
        <div class="viewport-bottom"><label class="toggle-label"><input id="show-source" type="checkbox"/> Show source</label><span>Drag to orbit <b>·</b> Scroll to zoom <b>·</b> Right-drag to pan</span><div class="axis"><span>Z ↑</span><small>mm</small></div></div>
        <div class="statusbar"><div id="status" role="status" aria-live="polite"><i></i> Preparing your ghost…</div><div id="mesh-stats">—</div></div>
        <div class="notice" id="notice" role="alert" hidden></div>
      </div>
    </main>`;
}
