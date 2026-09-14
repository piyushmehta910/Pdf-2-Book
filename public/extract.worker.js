/* pdf2book extraction Web Worker.
 *
 * Loads pdf.js, Tesseract.js and mammoth's browser build via importScripts so
 * the UI thread never blocks on large files. The classification heuristics
 * live in /extract-core.js (pure functions, reused by the test suite).
 *
 * Protocol:
 *   receive { id, type: 'pdf'|'docx'|'text', filename, buffer }
 *   emits   { id, event: 'progress', page, total }
 *           { id, event: 'done', pages, stats }
 *           { id, event: 'error', message }
 */
if (typeof importScripts === 'function') {
  importScripts('/vendor/pdf.min.js');
  importScripts('/vendor/mammoth.browser.min.js');
  importScripts('/vendor/tesseract.min.js');
  importScripts('/extract-core.js');
}

const CORE = self.ExtractCore;
const PDF_WORKER_URL = '/vendor/pdf.worker.min.js';
const MAX_EMBEDDED_IMAGES = 8;
const MAX_IMAGE_DATA_URL = 260000;

/* ================================================================== *
 *  PDF: text lines, images, OCR gate
 * ================================================================== */
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

async function extractImages(page) {
  const out = [];
  const pdfjsLib = self.pdfjsLib || {};
  const OPS = pdfjsLib.OPS || {};
  const paintFns = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintImageXObjectRepeat,
    OPS.paintJpegXObject,
    OPS.paintJpegXObjectRepeat
  ].filter((x) => typeof x === 'number'));

  let opList;
  try { opList = await page.getOperatorList(); } catch (_e) { return out; }

  const fns = opList.fnArray || [];
  const argsList = opList.argsArray || [];
  for (let i = 0; i < fns.length && out.length < MAX_EMBEDDED_IMAGES; i++) {
    const hasOp = paintFns.size > 0;
    if (hasOp && !paintFns.has(fns[i])) continue;
    const args = argsList[i] || [];
    const raw = args.length ? args[args.length - 1] : null;

    let obj = raw;
    if (!obj || typeof obj !== 'object') {
      try { obj = page.objs && page.objs.get ? page.objs.get(raw) : null; } catch (_e) { obj = null; }
    }
    if (!obj || typeof obj !== 'object') continue;

    const w = obj.width, h = obj.height;
    if (!(w > 0 && h > 0)) continue;

    const y = (obj.transform && obj.transform.length >= 6) ? -obj.transform[5] : 0;
    const entry = { y, width: Math.round(w), height: Math.round(h), placeholder: true };

    const imgData = obj.imgData;
    if (imgData && makeCanvas) {
      try {
        const cv = makeCanvas(Math.round(w), Math.round(h));
        const ctx = cv.getContext('2d');
        if (ctx && typeof ctx.putImageData === 'function') {
          const clamped = imgData instanceof Uint8ClampedArray ? imgData : new Uint8ClampedArray(imgData);
          ctx.putImageData(new ImageData(clamped, Math.round(w), Math.round(h)), 0, 0);
          if (typeof cv.toDataURL === 'function') {
            const url = cv.toDataURL('image/png');
            if (url && url.length <= MAX_IMAGE_DATA_URL) {
              entry.dataUrl = url;
              entry.placeholder = false;
            }
          }
        }
      } catch (_e) { /* keep placeholder */ }
    }
    out.push(entry);
  }
  return out;
}

function ocrPdfPage(page) {
  const T = self.Tesseract;
  if (!T) return Promise.reject(new Error('OCR engine unavailable'));
  return page.getViewport({ scale: 1 }).then((vp) => {
    const scale = Math.min(2, 1400 / Math.max(1, vp.width));
    const viewport = page.getViewport({ scale });
    const canvas = makeCanvas(Math.round(viewport.width), Math.round(viewport.height));
    if (!canvas) return Promise.reject(new Error('OffscreenCanvas unsupported'));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return page.render({ canvasContext: ctx, viewport }).promise.then((blob) => {
      return T.createWorker('eng', 1, {
        workerPath: '/vendor/tesseract.worker.min.js',
        corePath: '/vendor/tesseract-core-simd.wasm.js',
        langPath: '/vendor/lang',
        logger: () => {}
      }).then((worker) => worker.recognize(blob).then((res) => {
        const text = String(res && res.data && res.data.text ? res.data.text : '').trim();
        return worker.terminate().then(() => text);
      }));
    });
  });
}

async function extractPdf(id, filename, buffer, post) {
  const pdfjsLib = self.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdf.js did not load');
  pdfjsLib.GlobalWorkerOptions = pdfjsLib.GlobalWorkerOptions || {};
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    post({ id, event: 'progress', page: p, total: pdf.numPages });
    let page = null;
    try {
      page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = CORE.groupLines(content.items);
      const images = await extractImages(page);
      const table = CORE.detectTable(lines);
      const pageText = lines.map((l) => l.text).join(' ');
      let ocrApplied = false;
      let ocrText = null;
      if (CORE.needsOcr(pageText)) {
        post({ id, event: 'event', name: 'ocr', page: p });
        try {
          ocrText = await ocrPdfPage(page);
          if (ocrText) ocrApplied = true;
        } catch (_e) { /* OCR unavailable; keep the "may need OCR" flag */ }
      }
      const pageData = CORE.buildPage({ filename, pageNumber: p, lines, images, table, ocrText, ocrApplied });
      pages.push(pageData);
    } finally {
      if (page && page.cleanup) page.cleanup();
    }
  }
  return { pages, stats: { pages: pdf.numPages } };
}

/* ================================================================== *
 *  DOCX (mammoth) and generic text
 * ================================================================== */
async function extractDocx(id, filename, buffer, post) {
  const mammoth = self.mammoth;
  if (!mammoth) throw new Error('mammoth did not load');
  post({ id, event: 'progress', page: 1, total: 1 });
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const page = CORE.docxToPage(result.value, { filename, pageNumber: 1 });
  return { pages: [page], stats: { pages: 1 } };
}

async function extractText(id, filename, buffer, post) {
  post({ id, event: 'progress', page: 1, total: 1 });
  const text = new TextDecoder().decode(buffer);
  const units = CORE.textPageUnits(text, { filename, pageNumber: 1 });
  const page = CORE.pageFromUnits(units, { filename, pageNumber: 1 });
  return { pages: [page], stats: { pages: 1 } };
}

/* ================================================================== *
 *  Message handling
 * ================================================================== */
self.onmessage = async (e) => {
  const msg = e.data || {};
  const id = msg.id;
  const post = (m) => { try { self.postMessage(m); } catch (_e) { /* worker closing */ } };

  if (!id || !msg.type) {
    post({ id: id || 'unknown', event: 'error', message: 'malformed extraction request' });
    return;
  }

  try {
    if (!(msg.buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(msg.buffer)) {
      throw new Error('expected an ArrayBuffer payload');
    }
    const buffer = msg.buffer instanceof ArrayBuffer ? msg.buffer : msg.buffer.buffer;
    const filename = String(msg.filename || 'source');

    let result;
    if (msg.type === 'pdf') result = await extractPdf(id, filename, buffer, post);
    else if (msg.type === 'docx') result = await extractDocx(id, filename, buffer, post);
    else if (msg.type === 'text') result = await extractText(id, filename, buffer, post);
    else throw new Error('unsupported file type: ' + msg.type);

    post({ id, event: 'done', pages: result.pages, stats: result.stats });
  } catch (err) {
    post({ id, event: 'error', message: String((err && err.message) || err) });
  }
};