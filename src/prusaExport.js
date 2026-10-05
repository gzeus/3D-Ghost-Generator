import { createSTLFile } from './exportSTL.js';

export function canOpenPrusaSlicer(navigator) {
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function uploadToPrusa(file, { signal, onProgress = () => {}, sourceUrl } = {}) {
  if (file.size > 100 * 1000 * 1000) return Promise.reject(new Error('Prusa accepts models up to 100 MB. Download the STL locally instead.'));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (callback, value) => { signal?.removeEventListener('abort', abort); callback(value); };
    xhr.open('POST', 'https://slicer.printables.com/import');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 120000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total * 100); };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(json.error === 'file-too-large' ? 'Prusa accepts models up to 100 MB.' : `Prusa upload failed (${json.error || xhr.status}). Please retry.`);
        const easyprint = new URL(json.easyprint_url), slicer = new URL(json.prusaslicer_url);
        const fileUrl = new URL(slicer.searchParams.get('file'));
        if (easyprint.origin !== 'https://www.printables.com' || easyprint.pathname !== '/slice' ||
            slicer.protocol !== 'prusaslicer:' || slicer.hostname !== 'open' ||
            fileUrl.origin !== 'https://slicer.printables.com' || !fileUrl.pathname.startsWith('/import/temp/')) {
          throw new Error('Prusa returned an unexpected destination. Please retry.');
        }
        finish(resolve, json);
      } catch (error) { finish(reject, error); }
    };
    xhr.onerror = () => finish(reject, new Error('Could not reach Prusa. Check your connection and retry.'));
    xhr.ontimeout = () => finish(reject, new Error('Prusa upload timed out. Please retry.'));
    xhr.onabort = () => finish(reject, new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('file_source_name', 'Ghost Studio');
    if (sourceUrl) form.append('file_source_url', sourceUrl);
    xhr.send(form);
  });
}

export function setupPrusaExports({ getModel, playSound, status, notice }) {
  const $ = id => document.getElementById(id);
  const dialog = $('prusa-upload');
  let controller;
  $('export-prusaslicer').hidden = !canOpenPrusaSlicer(navigator);
  const sync = () => {
    for (const id of ['export-easyprint', 'export-prusaslicer']) $(id).disabled = $('export').disabled || !!controller;
  };
  new MutationObserver(sync).observe($('export'), { attributes: true, attributeFilter: ['disabled'] });
  sync();
  dialog.addEventListener('cancel', event => {
    if (controller) { event.preventDefault(); controller.abort(); }
  });
  $('cancel-upload').addEventListener('click', () => controller?.abort());
  for (const target of ['easyprint', 'prusaslicer']) {
    $(`export-${target}`).addEventListener('click', async () => {
      const { geometry, filename } = getModel();
      if (!geometry || $('export').disabled || controller) return;
      let file;
      try { file = createSTLFile(geometry, filename); } catch (error) { notice(error.message); return; }
      if (file.size > 100 * 1000 * 1000) { notice('Prusa accepts models up to 100 MB. Download the STL locally instead.'); return; }
      playSound(); notice();
      controller = new AbortController(); sync();
      $('upload-progress').value = 0;
      $('upload-status').textContent = 'Uploading ghost to Prusa… 0%';
      $('prusa-continue').hidden = true;
      $('cancel-upload').textContent = 'Cancel upload';
      dialog.showModal();
      try {
        const json = await uploadToPrusa(file, {
          signal: controller.signal,
          sourceUrl: /^https?:$/.test(location.protocol) ? location.origin + location.pathname : undefined,
          onProgress: percent => {
            $('upload-progress').value = percent;
            $('upload-status').textContent = percent >= 100 ? 'Preparing your model…' : `Uploading ghost to Prusa… ${Math.round(percent)}%`;
          }
        });
        const link = $('prusa-continue');
        link.href = target === 'easyprint' ? json.easyprint_url : json.prusaslicer_url;
        link.target = target === 'easyprint' ? '_blank' : '_self';
        link.textContent = target === 'easyprint' ? 'Continue to EasyPrint ↗' : 'Open PrusaSlicer';
        link.hidden = false;
        // Keep a real link available if the browser blocks the automatic handoff.
        if (target === 'easyprint') window.open(json.easyprint_url, '_blank', 'noopener,noreferrer');
        else link.click();
        $('upload-status').textContent = 'Model ready. Use the link below if it did not open. Links expire in 30 minutes.';
        $('cancel-upload').textContent = 'Done';
        status('Ghost sent to Prusa · happy printing');
      } catch (error) {
        dialog.close();
        if (error.name === 'AbortError') status('Prusa upload cancelled');
        else { notice(error.message); status('Could not export to Prusa', 'error'); }
      } finally {
        controller = undefined; sync();
      }
    });
  }
  $('cancel-upload').addEventListener('click', () => { if (!controller) dialog.close(); });
  dialog.addEventListener('close', () => { $('cancel-upload').textContent = 'Cancel upload'; });
}
