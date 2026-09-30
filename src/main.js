import * as THREE from 'three';
import { renderUI } from './ui.js';
import { createViewer } from './viewer.js';
import { defaults } from './ghostGenerator.js';
import { exportSTL } from './exportSTL.js';
import './style.css';

renderUI();
const $ = id => document.getElementById(id);
let viewer;
try { viewer = createViewer($('viewport')); viewer.start(); }
catch (error) { $('notice').hidden = false; $('notice').textContent = 'The 3D preview needs WebGL. Enable hardware acceleration or try a WebGL-capable browser.'; throw error; }
let worker, sourceReady = false, busy = false, revision = 0, pending = false, ghost, timer, fitNext = true, filename = 'rabbit', sourceSize;
const rotation = () => ['x', 'y', 'z'].map(a => Number($(`rotate-${a}`).value) || 0);
const normalized = new Set(['cutoff', 'smoothing', 'bottomSpread', 'foldIrregularity', 'asymmetry']);
function parameters() {
  const p = { ...defaults };
  document.querySelectorAll('input[type=range]').forEach(input => { p[input.id] = Number(input.value) / (normalized.has(input.id) ? 100 : 1); });
  p.skirtHeight = $('skirtHeight').value === '' ? null : Number($('skirtHeight').value);
  return p;
}
function status(message, state = '') { $('status').className = state; $('status').replaceChildren(); const dot = document.createElement('i'); $('status').append(dot, document.createTextNode(message)); }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function updateSource() {
  if (!sourceReady) return;
  sourceSize = viewer.orient(rotation(), parameters().cutoff);
  $('source-details').textContent = `${sourceSize.x.toFixed(1)} × ${sourceSize.y.toFixed(1)} × ${sourceSize.z.toFixed(1)} mm`;
}
function generate() {
  clearTimeout(timer);
  if (!sourceReady) return;
  if (busy) { pending = true; return; }
  busy = true; pending = false;
  $('export').disabled = true; status('Shaping your ghost…', 'busy'); notice();
  worker.postMessage({ type: 'generate', id: revision, rotation: rotation(), params: parameters() });
}
function invalidate(reorient = false) {
  revision++; $('export').disabled = true;
  if (reorient) updateSource();
  status('Changes pending…', 'busy'); clearTimeout(timer); timer = setTimeout(generate, 200);
}
function newWorker() {
  worker?.terminate(); busy = false; pending = false; sourceReady = false;
  worker = new Worker(new URL('./generation.worker.js', import.meta.url), { type: 'module' });
  worker.onerror = () => { busy = false; sourceReady = false; status('Processing interrupted', 'error'); notice('The browser could not process this mesh. Try a smaller STL or reload the example.'); };
  worker.onmessage = ({ data }) => {
    if (data.type === 'loaded') {
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.computeVertexNormals();
      viewer.setSource(geometry); sourceReady = true; updateSource(); viewer.fit(); generate(); return;
    }
    busy = false;
    if (data.type === 'error') {
      if (data.id !== undefined && data.id !== revision) { generate(); return; }
      status('Could not generate ghost', 'error'); notice(data.message); return;
    }
    if (data.id !== revision) { generate(); return; }
    ghost = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    ghost.setIndex(new THREE.BufferAttribute(data.indices, 1)); ghost.computeVertexNormals(); ghost.userData = data.debug;
    viewer.setGhost(ghost); if (fitNext) { viewer.fit(); fitNext = false; }
    $('export').disabled = false;
    status('Watertight · flat base verified');
    $('mesh-stats').textContent = `${data.stats.triangles.toLocaleString()} triangles · ${data.stats.height.toFixed(1)} mm tall`;
    if (data.flat) notice('This source is very flat. Rotate it upright or increase the skirt height for a more recognizable ghost.');
    if (parameters().cutoff === 1) notice('At 100%, a thin band just below the highest point is used to keep the envelope stable.');
    if (pending) generate();
  };
}
let loadToken = 0;
async function load(file) {
  const token = ++loadToken;
  if (file && (!/\.stl$/i.test(file.name) || file.size > 120 * 1024 * 1024)) { notice('Choose an STL file smaller than 120 MB.'); return; }
  clearTimeout(timer); revision++; fitNext = true; $('export').disabled = true; notice(); status('Reading source locally…', 'busy');
  newWorker();
  try {
    const buffer = file ? await file.arrayBuffer() : null;
    if (token !== loadToken) return;
    filename = file?.name || 'rabbit.stl'; $('filename').textContent = file?.name || 'Rabbit example';
    ['x','y','z'].forEach(a => { $(`rotate-${a}`).value = 0; });
    worker.postMessage({ type: 'load', buffer }, buffer ? [buffer] : []);
  } catch (error) { status('Could not read file', 'error'); notice(error.message); }
}
document.querySelectorAll('input[type=range]').forEach(input => {
  const show = () => { const unit = input.dataset.unit; $(`${input.id}-value`).textContent = `${input.value}${unit === 'mm' ? ' ' : ''}${unit}`; input.style.setProperty('--fill', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`); };
  show(); input.addEventListener('input', () => { show(); invalidate(input.id === 'cutoff'); });
});
['x','y','z'].forEach(a => $(`rotate-${a}`).addEventListener('input', () => invalidate(true)));
$('skirtHeight').addEventListener('input', () => invalidate());
$('reset').addEventListener('click', () => { ['x','y','z'].forEach(a => { $(`rotate-${a}`).value = 0; }); invalidate(true); });
$('generate').addEventListener('click', generate);
$('fit').addEventListener('click', () => viewer.fit());
$('demo').addEventListener('click', () => load());
$('export').addEventListener('click', () => { if (ghost && !$('export').disabled) { exportSTL(ghost, filename); status('STL exported · happy printing'); } });
$('file').addEventListener('change', event => { const file = event.target.files[0]; if (file) load(file); event.target.value = ''; });
const drop = $('drop-zone');
['dragenter','dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('dragging'); }));
['dragleave','drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('dragging'); }));
drop.addEventListener('drop', event => { if (event.dataTransfer.files[0]) load(event.dataTransfer.files[0]); });
window.addEventListener('dragover', event => event.preventDefault()); window.addEventListener('drop', event => event.preventDefault());
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); viewer.setMode(button.dataset.mode); }));
$('show-source').addEventListener('change', event => viewer.setSourceVisible(event.target.checked));
document.querySelectorAll('[data-debug]').forEach(input => input.addEventListener('change', () => viewer.setDebug(input.dataset.debug, input.checked)));
load();
