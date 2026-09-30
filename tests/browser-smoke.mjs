// Optional real-browser smoke test, using Chrome's DevTools protocol (no test dependencies).
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

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
  const waitFor = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out: ${expression}; status ${await evaluate('document.body.innerText')}`); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
  await send('Page.navigate', { url: process.env.APP_URL || 'http://127.0.0.1:5173' });
  await waitFor('document.querySelector("#export") && !document.querySelector("#export").disabled');
  assert.match(await evaluate('document.querySelector("#status").textContent'), /Watertight/);
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'desktop.png'), Buffer.from(shot.data, 'base64'));
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
  await writeFile(path.join(artifacts, 'bad.stl'), 'not an STL');
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(artifacts, 'bad.stl')] });
  await waitFor('!document.querySelector("#notice").hidden');
  assert.equal(await evaluate('document.querySelector("#export").disabled'), true);
  await evaluate('document.querySelector("#demo").click()');
  await waitFor('!document.querySelector("#export").disabled');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  const mobile = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('Browser checks passed: demo, live updates, orientation, preview modes, upload, export, invalid STL recovery, mobile layout.');
  await send('Browser.close');
} finally { socket?.close(); chrome.kill(); }
