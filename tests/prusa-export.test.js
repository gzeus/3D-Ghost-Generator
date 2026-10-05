import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenPrusaSlicer, uploadToPrusa } from '../src/prusaExport.js';

test('Prusa handoff excludes mobile OSes while allowing Windows touchscreens', () => {
  for (const userAgent of ['Android', 'iPhone', 'iPad', 'iPod']) assert.equal(canOpenPrusaSlicer({userAgent,maxTouchPoints:1}),false);
  assert.equal(canOpenPrusaSlicer({userAgent:'Macintosh',maxTouchPoints:5}),false);
  for (const userAgent of ['Windows NT', 'Linux', 'Macintosh']) assert.equal(canOpenPrusaSlicer({userAgent,maxTouchPoints:userAgent==='Windows NT'?10:0}),true);
});

test('oversize files and already cancelled requests never start an upload', async () => {
  await assert.rejects(uploadToPrusa({size:100000001}), /100 MB/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(uploadToPrusa({size:12},{signal:controller.signal}), {name:'AbortError'});
});
