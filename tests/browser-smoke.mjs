// Optional real-browser smoke test, using Chrome's DevTools protocol (no test dependencies).
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { validateSolid } from '../src/meshUtils.js';
import { demoGeometry } from '../src/stlImport.js';
import { archive3MF, modelXML, tetraMesh, wideOBJ } from './import-fixtures.js';

const artifacts = path.resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=9223', `--user-data-dir=${path.resolve('.browser-profile')}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
chrome.stderr.on('data', chunk => { chromeLog += chunk.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch('http://127.0.0.1:9223/json')).json(); break; } catch { await sleep(200); } }
  assert.ok(targets, 'Chrome remote debugging started');
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0; const waiting = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    if (result.id) { const pending = waiting.get(result.id); waiting.delete(result.id); if (result.error) pending?.reject(new Error(result.error.message)); else pending?.resolve(result.result); }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}; ${chromeLog}`)), 20000); waiting.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out: ${expression}; status ${await evaluate('document.body.innerText')}`); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
  await send('Page.navigate', { url: process.env.APP_URL || 'http://127.0.0.1:5173' });
  await waitFor('document.querySelector("#export") && !document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#status").textContent'), /Manifold shell/);
  assert.equal(await evaluate('document.querySelector("#hollow").checked'), true);
  assert.equal(await evaluate('document.querySelector("#cutoff").value'), '25');
  assert.equal(await evaluate('document.querySelector("#proceduralEyes").checked'), false);
  assert.equal(await evaluate('document.querySelector("#paired-eye-controls").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#placed-eye-controls").hidden'), false);
  for (const id of ['export-easyprint', 'export-prusaslicer']) {
    await waitFor(`document.querySelector('#${id} img').complete && document.querySelector('#${id} img').naturalWidth > 0`);
  }
  assert.equal(await evaluate('document.querySelector(".viewport-top h2").textContent'), 'Watch out - the export is Spoooky!');
  assert.equal(await evaluate('document.querySelector(".viewport-caption")'), null);
  await evaluate(`window.exportAudioCalls = []; const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.exportAudioCalls.push(this); return originalPlay.call(this); };`);
  await evaluate(`
    window.savedXHR = window.XMLHttpRequest; window.savedOpen = window.open;
    window.savedAnchorClick = HTMLAnchorElement.prototype.click;
    window.prusaRequests = []; window.prusaOpened = []; window.prusaMode = 'success';
    window.open = (...args) => { window.prusaOpened.push(args); return null; };
    HTMLAnchorElement.prototype.click = function () {
      if (this.href.startsWith('prusaslicer:')) window.prusaOpened.push([this.href]);
      else window.savedAnchorClick.call(this);
    };
    window.XMLHttpRequest = class {
      constructor() { this.upload = {}; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(name, value) { this.accept = value; }
      send(form) {
        window.prusaRequests.push({method:this.method, url:this.url, accept:this.accept, file:form.get('file').name, type:form.get('file').type});
        this.upload.onprogress({lengthComputable:true, loaded:50, total:100});
        if (window.prusaMode === 'wait') return;
        setTimeout(() => {
          this.status = window.prusaMode === 'error' ? 500 : 200;
          this.responseText = JSON.stringify(this.status === 500 ? {error:'upload-failed'} : {
            easyprint_url:'https://www.printables.com/slice?file_url=test',
            prusaslicer_url:'prusaslicer://open?file=https%3A%2F%2Fslicer.printables.com%2Fimport%2Ftemp%2Ftest.stl'
          }); this.onload();
        }, 20);
      }
      abort() { this.onabort(); }
    };
    if (document.querySelector('#toggle-sounds').getAttribute('aria-pressed') === 'true') document.querySelector('#toggle-sounds').click();
    document.querySelector('#export-easyprint').click();
  `);
  await waitFor('!document.querySelector("#prusa-continue").hidden');
  assert.equal(await evaluate('window.prusaOpened[0][1]'), '_blank');
  assert.deepEqual(await evaluate('window.prusaRequests[0]'), {method:'POST',url:'https://slicer.printables.com/import',accept:'application/json',file:'benchy_example_ghost.stl',type:'model/stl'});
  assert.equal(await evaluate('window.exportAudioCalls.length'), 1);
  await evaluate('document.querySelector("#cancel-upload").click(); document.querySelector("#export-prusaslicer").click();');
  await waitFor('window.prusaOpened.length === 2');
  assert.match(await evaluate('window.prusaOpened[1][0]'), /^prusaslicer:/);
  assert.equal(await evaluate('window.exportAudioCalls.length'), 2);
  await evaluate('document.querySelector("#cancel-upload").click(); document.querySelector("#toggle-sounds").click(); window.prusaMode="wait"; document.querySelector("#export-easyprint").click();');
  assert.equal(await evaluate('document.querySelector("#upload-progress").value'), 50);
  assert.equal(await evaluate('window.exportAudioCalls.length'), 2);
  assert.equal(await evaluate('localStorage.getItem("ghost-studio-spooky-sounds")'), 'off');
  await evaluate('document.querySelector("#cancel-upload").click()');
  await waitFor('!document.querySelector("#prusa-upload").open');
  assert.match(await evaluate('document.querySelector("#status").textContent'), /cancelled/);
  await evaluate('window.prusaMode="error"; document.querySelector("#export-prusaslicer").click()');
  await waitFor('!document.querySelector("#notice").hidden');
  assert.match(await evaluate('document.querySelector("#notice").textContent'), /upload-failed/);
  await evaluate('window.XMLHttpRequest=window.savedXHR; window.open=window.savedOpen; HTMLAnchorElement.prototype.click=window.savedAnchorClick; document.querySelector("#toggle-sounds").click(); window.exportAudioCalls=[];');
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'desktop.png'), Buffer.from(shot.data, 'base64'));
  assert.equal(await evaluate('document.querySelector("#filename").textContent'), 'benchy_example.stl');
  const activeMode = () => evaluate('document.querySelector("[data-mode].active").dataset.mode');
  for (const mode of ['ghost', 'overlay', 'source']) {
    await evaluate(`document.querySelector('[data-mode=${mode}]').click(); document.querySelector('#cutoff').scrollIntoView({block:'center'});`);
    const bounds = await evaluate('JSON.stringify(document.querySelector("#cutoff").getBoundingClientRect())');
    const rect = JSON.parse(bounds), x = rect.x + rect.width * 0.58, y = rect.y + rect.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    assert.equal(await activeMode(), 'source');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 10, y, buttons: 1 });
    assert.equal(await activeMode(), 'source');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 10, y, button: 'left', clickCount: 1 });
    assert.equal(await activeMode(), mode);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal(await activeMode(), 'source');
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal(await activeMode(), mode);
  }
  await evaluate('document.querySelector("[data-mode=ghost]").click(); document.querySelector("#cutoff").value=58; document.querySelector("#cutoff").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  // Keep the established geometry/eye-placement regression fixture independent of the bundled example.
  const rabbit = demoGeometry();
  await writeFile(path.join(artifacts, 'rabbit.stl'), Buffer.from(new STLExporter().parse(new THREE.Mesh(rabbit), { binary: true }).buffer));
  rabbit.dispose();
  const fixtureDocument = await send('DOM.getDocument');
  const fixtureInput = await send('DOM.querySelector', { nodeId: fixtureDocument.root.nodeId, selector: '#file' });
  await send('DOM.setFileInputFiles', { nodeId: fixtureInput.nodeId, files: [path.join(artifacts, 'rabbit.stl')] });
  await waitFor('document.querySelector("#filename").textContent === "rabbit.stl" && !document.querySelector("#export").disabled');
  await evaluate('document.querySelector("#hollow").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await evaluate('document.querySelector("#topSmoothing-value").textContent'), '35%');
  for (const value of [0, 100, 35]) {
    await evaluate(`document.querySelector("#topSmoothing").value=${value}; document.querySelector("#topSmoothing").dispatchEvent(new Event("input"));`);
    assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
    await waitFor('!document.querySelector("#export").disabled');
    assert.equal(await evaluate('document.querySelector("#topSmoothing-value").textContent'), `${value}%`);
  }
  await evaluate('document.querySelector("#targetSize").value=130.5; document.querySelector("#targetSize").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /60.0 × 51.0 × 130.5/);
  await evaluate('document.querySelector("#targetSize").value=0; document.querySelector("#targetSize").dispatchEvent(new Event("input"));');
  await waitFor('document.querySelector("#status").className === "error"');
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await evaluate('document.querySelector("#reset-size").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /40.0 × 34.0 × 87.0/);
  await evaluate('document.querySelector("#eyes").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await evaluate('document.querySelector("#proceduralEyes").checked'), false);
  assert.match(await evaluate('document.querySelector("#placed-eye-count").textContent'), /^0 eyes/);
  assert.doesNotMatch(await evaluate('document.querySelector("#output-note").textContent'), /eye openings/);
  await evaluate('document.querySelector("#proceduralEyes").click()');
  assert.equal(await evaluate('document.querySelector("#hollow").checked'), true);
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#output-note").textContent'), /2 mm walls.*open underside.*eye openings/);
  await evaluate('document.querySelector("#hollow").scrollIntoView({block:"start"})');
  await sleep(300);
  const hollowShot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'hollow-eyes.png'), Buffer.from(hollowShot.data, 'base64'));
  await rm(path.join(artifacts, 'rabbit_ghost.stl'), { force: true });
  await evaluate('document.querySelector("#export").click()');
  for (let i = 0; i < 50 && !(await readdir(artifacts)).includes('rabbit_ghost.stl'); i++) await sleep(100);
  const downloadedHollow = await readFile(path.join(artifacts, 'rabbit_ghost.stl'));
  assert.equal(await evaluate('window.exportAudioCalls.length'), 1);
  assert.match(await evaluate('window.exportAudioCalls[0].src'), /boo[1-4](?:-[\w-]+)?\.wav/);
  assert.equal(await evaluate('window.exportAudioCalls[0].loop'), false);
  await waitFor('window.exportAudioCalls[0].readyState >= 2');
  assert.equal(await evaluate('window.exportAudioCalls[0].error'), null);
  const hollowGeometry = new STLLoader().parse(downloadedHollow.buffer.slice(downloadedHollow.byteOffset, downloadedHollow.byteOffset + downloadedHollow.byteLength));
  hollowGeometry.deleteAttribute('normal');
  assert.equal(validateSolid(mergeVertices(hollowGeometry, 1e-6)).watertight, true);
  await evaluate('document.querySelector("#eyeShape").value="round"; document.querySelector("#eyeShape").dispatchEvent(new Event("change"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await evaluate('document.querySelector("#eyeHeight-row").hidden'), true);
  await evaluate('document.querySelector("#openBottom").click(); document.querySelector("#wallThickness").value=2.5; document.querySelector("#wallThickness").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#output-note").textContent'), /2.5 mm walls.*closed floor/);
  await evaluate('document.querySelector("#eyeSpacing").value=1; document.querySelector("#eyeSpacing").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#notice").hidden');
  assert.match(await evaluate('document.querySelector("#notice").textContent'), /spacing/);
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await evaluate('document.querySelector("#hollow").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await evaluate('document.querySelector("#eyes").checked'), false);
  await evaluate('document.querySelector("#eyes").click(); document.querySelector("#proceduralEyes").click(); document.querySelector("#eyeShape").value="oval"; document.querySelector("#eyeShape").dispatchEvent(new Event("change")); document.querySelector("#eyeWidth").value=3; document.querySelector("#eyeWidth").dispatchEvent(new Event("input")); document.querySelector("#eyeHeight").value=5; document.querySelector("#eyeHeight").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#placed-eye-count").textContent'), /^0 eyes/);
  const clickScene = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await clickScene(400, 300); // Empty space must not add anything.
  assert.match(await evaluate('document.querySelector("#placed-eye-count").textContent'), /^0 eyes/);
  await clickScene(850, 605);
  await waitFor('document.querySelector("#placed-eye-list").children.length === 1 && !document.querySelector("#export").disabled');
  await evaluate('document.querySelector("#eyeShape").value="round"; document.querySelector("#eyeShape").dispatchEvent(new Event("change")); document.querySelector("#eyeWidth").value=4; document.querySelector("#eyeWidth").dispatchEvent(new Event("input"));');
  assert.equal(await evaluate('document.querySelector("#export").disabled'), false, 'Brush settings affect only future placements');
  await clickScene(913, 650);
  await waitFor('document.querySelector("#placed-eye-list").children.length === 2 && !document.querySelector("#export").disabled');
  await clickScene(834, 719);
  await waitFor('document.querySelector("#placed-eye-list").children.length === 3 && !document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#placed-eye-list").textContent'), /Oval · 3 × 5 mm.*Round · 4 × 4 mm/);
  await evaluate('document.querySelector("#proceduralEyes").scrollIntoView({block:"start"})');
  const clickShot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'click-eyes.png'), Buffer.from(clickShot.data, 'base64'));
  await clickScene(850, 605); // An existing opening must not target the inner rear wall.
  assert.equal(await evaluate('document.querySelector("#placed-eye-list").children.length'), 3);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 870, y: 600, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 950, y: 620, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 950, y: 620, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('document.querySelector("#placed-eye-list").children.length'), 3, 'Orbit drag does not place an eye');
  await rm(path.join(artifacts, 'rabbit_ghost.stl'), { force: true });
  await evaluate('document.querySelector("#export").click()');
  for (let i = 0; i < 50 && !(await readdir(artifacts)).includes('rabbit_ghost.stl'); i++) await sleep(100);
  const clickedSTL = await readFile(path.join(artifacts, 'rabbit_ghost.stl'));
  const clickedGeometry = new STLLoader().parse(clickedSTL.buffer.slice(clickedSTL.byteOffset, clickedSTL.byteOffset + clickedSTL.byteLength));
  clickedGeometry.deleteAttribute('normal'); validateSolid(mergeVertices(clickedGeometry, 1e-6));
  await evaluate('document.querySelector("#eyeSpacing").value=13; document.querySelector("#proceduralEyes").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#output-note").textContent'), /eye openings \(2\)/);
  await evaluate('document.querySelector("#proceduralEyes").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#output-note").textContent'), /eye openings \(3\)/);
  await evaluate('document.querySelector("#undo-eye").click()');
  await waitFor('document.querySelector("#placed-eye-list").children.length === 2 && !document.querySelector("#export").disabled');
  await evaluate('document.querySelector("#placed-eye-list button").click()');
  await waitFor('document.querySelector("#placed-eye-list").children.length === 1 && !document.querySelector("#export").disabled');
  await evaluate('document.querySelector("#clear-eyes").click()');
  await waitFor('document.querySelector("#placed-eye-list").children.length === 0 && !document.querySelector("#export").disabled');
  await evaluate('document.querySelector("#hollow").click(); document.querySelector("#fit").click()');
  await waitFor('!document.querySelector("#export").disabled');
  await evaluate('document.querySelector(".sidebar").scrollTop=0');
  await evaluate('document.querySelector("#foldCount").value = 12; document.querySelector("#foldCount").dispatchEvent(new Event("input"));');
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await evaluate('document.querySelector("#foldCount-value").textContent'), '12');
  await evaluate('document.querySelector("[data-mode=source]").click(); document.querySelector("#rotate-x").value = 90; document.querySelector("#rotate-x").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await evaluate('document.querySelector("[data-mode=source]").getAttribute("aria-pressed")'), 'true');
  await evaluate('document.querySelector("#reset").click(); document.querySelector("[data-mode=ghost]").click();');
  await waitFor('!document.querySelector("#export").disabled');
  const source = new THREE.BoxGeometry(25, 30, 65).translate(200, -100, 100);
  const stl = new STLExporter().parse(new THREE.Mesh(source), { binary: true });
  const fixture = path.join(artifacts, 'test-figurine.stl'); await writeFile(fixture, Buffer.from(stl.buffer));
  const doc = await send('DOM.getDocument'); const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file' });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [fixture] });
  await waitFor('document.querySelector("#filename").textContent === "test-figurine.stl" && !document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /25.0 × 30.0 × 65.0/);
  await evaluate('document.querySelector("#export").click()');
  let downloaded = false;
  for (let i = 0; i < 30; i++) { if ((await readdir(artifacts)).includes('test-figurine_ghost.stl')) { downloaded = true; break; } await sleep(100); }
  assert.ok(downloaded, 'STL download created');
  await writeFile(path.join(artifacts, 'wide.obj'), wideOBJ);
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(artifacts, 'wide.obj')] });
  await waitFor('document.querySelector("#filename").textContent === "wide.obj" && !document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /100.0 × 20.0 × 10.0/);
  await evaluate('document.querySelector("#targetSize").value=50; document.querySelector("#targetSize").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /500.0 × 100.0 × 50.0/);
  await evaluate('document.querySelector("#rotate-x").value=90; document.querySelector("#rotate-x").dispatchEvent(new Event("input"));');
  await waitFor('!document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /250.0 × 25.0 × 50.0/);
  const model3MF = archive3MF(modelXML(`<object id="1">${tetraMesh}</object>`, '<item objectid="1"/>', 'centimeter'));
  await writeFile(path.join(artifacts, 'test-3mf.3mf'), Buffer.from(model3MF));
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(artifacts, 'test-3mf.3mf')] });
  await waitFor('document.querySelector("#filename").textContent === "test-3mf.3mf" && !document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#source-details").textContent'), /10.0 × 20.0 × 30.0/);
  assert.equal(await evaluate('document.querySelector("#targetSize").value'), '');
  await rm(path.join(artifacts, 'test-3mf_ghost.stl'), { force: true });
  await evaluate('document.querySelector("#export").click()');
  for (let i = 0; i < 50 && !(await readdir(artifacts)).includes('test-3mf_ghost.stl'); i++) await sleep(100);
  assert.ok((await readdir(artifacts)).includes('test-3mf_ghost.stl'), '3MF import exports STL with a clean filename');
  await writeFile(path.join(artifacts, 'broken.3mf'), 'invalid zip');
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(artifacts, 'broken.3mf')] });
  await waitFor('!document.querySelector("#notice").hidden');
  assert.match(await evaluate('document.querySelector("#notice").textContent'), /3MF/);
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await writeFile(path.join(artifacts, 'bad.stl'), 'not an STL');
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(artifacts, 'bad.stl')] });
  await waitFor('!document.querySelector("#notice").hidden');
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await evaluate('document.querySelector("#demo").click()');
  await waitFor('!document.querySelector("#export").disabled');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  await evaluate('window.scrollTo(0,0); document.querySelector("[data-mode=overlay]").click()');
  const sliderRect = await evaluate('(()=>{const r=document.querySelector("#preview-cutoff").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [sliderRect] });
  assert.equal(await activeMode(), 'source');
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x:sliderRect.x,y:sliderRect.y-20}] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await activeMode(), 'overlay');
  assert.equal(await evaluate('document.querySelector("#cutoff").value'), await evaluate('document.querySelector("#preview-cutoff").value'));
  await waitFor('!document.querySelector("#export").disabled');
  await evaluate('document.querySelector("#cutoff").value=58; document.querySelector("#cutoff").dispatchEvent(new Event("input"));');
  assert.equal(await evaluate('document.querySelector("#preview-cutoff-value").textContent'), '58%');
  await waitFor('!document.querySelector("#export").disabled');
  await evaluate('document.querySelector("[data-mode=source]").click(); document.querySelector("#preview-eyes").click()');
  await waitFor('!document.querySelector("#export").disabled');
  assert.equal(await activeMode(), 'ghost');
  assert.equal(await evaluate('document.querySelector("#preview-eyes").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.querySelector("#eyes").checked && document.querySelector("#hollow").checked && !document.querySelector("#proceduralEyes").checked'), true);
  await evaluate('document.querySelector("#preview-eyes").click()');
  assert.equal(await evaluate('document.querySelector("#placement-banner").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#eyes").checked'), true);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  const mobile = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('Browser checks passed: click placement, three independent eyes, orbit/miss/opening filtering, per-eye sizes, paired mode preservation, undo/remove/clear, clicked STL round trip, hollowing, round/oval eyes, wall thickness, open/closed floor, hollow STL round trip, invalid eye settings, demo, live updates, orientation, preview modes, upload, export, invalid STL recovery, mobile layout.');
  await send('Browser.close');
} finally { socket?.close(); chrome.kill(); }
