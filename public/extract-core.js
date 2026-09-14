/**
 * pdf2book extraction-core: pure, DOM-free heuristics shared between the
 * extraction Web Worker and the test suite.
 *
 * Responsibilities:
 *   - PDF: group raw pdf.js text items into lines, detect headings (font-size
 *     / weight heuristics), detect table-like layouts (or flag for manual
 *     review), flag pages that "may need OCR", and assemble page results.
 *   - DOCX: convert mammoth-generated HTML into typed text units, preserving
 *     heading levels and basic bold/italic formatting.
 *   - Emit a uniform unit shape:
 *       { sourceId, filename, pageNumber, type, text, ...extra }
 *     where type is 'heading' | 'paragraph' | 'table' | 'image' | 'caption'.
 *
 * Exposes `window.ExtractCore` in the browser (loadable via importScripts in
 * a Worker) and `module.exports` under Node for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExtractCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OCR_MIN_TEXT = 40;
  const MAX_HEADING_LEN = 400;
  const IMAGE_CAPTION_MAX = 200;

  /* ---------- text helpers ---------- */
  function normWs(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function stripWs(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '').trim();
  }

  function countWords(s) {
    const t = normWs(s);
    return t ? t.split(' ').length : 0;
  }

  function median(nums) {
    const v = nums.filter((n) => n > 0).sort((a, b) => a - b);
    if (!v.length) return 0;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /* ---------- line grouping (raw pdf.js items -> lines) ---------- */
  function groupLines(items) {
    if (!items || !items.length) return [];
    const lines = [];
    let cur = null;

    const flush = () => {
      if (cur && cur.text.trim()) {
        lines.push({
          text: normWs(cur.text),
          top: cur.top,
          height: cur.height,
          x0: cur.x0,
          xStarts: cur.xStarts,
          avgSize: cur.sizeSum / Math.max(1, cur.sizeCount),
          fontName: cur.fontName
        });
      }
      cur = { text: '', top: Infinity, height: 0, x0: Infinity, xStarts: [], sizeSum: 0, sizeCount: 0, fontName: null };
    };
    cur = { text: '', top: Infinity, height: 0, x0: Infinity, xStarts: [], sizeSum: 0, sizeCount: 0, fontName: null };

    for (const it of items) {
      const str = it && it.str ? String(it.str) : '';
      if (!str.trim()) {
        if (it && it.hasEOL) flush();
        continue;
      }
      const transform = (it && it.transform) || [1, 0, 0, 1, 0, 0];
      const fs = it && it.height && isFinite(it.height) && it.height > 0
        ? it.height
        : Math.abs(transform[3]);
      cur.top = Math.min(cur.top, transform[5]);
      cur.x0 = Math.min(cur.x0, transform[4]);
      cur.height = Math.max(cur.height, fs);
      cur.sizeSum += fs || 0;
      cur.sizeCount += 1;
      if (cur.fontName == null && it.fontName) cur.fontName = it.fontName;
      const xs = Math.round(transform[4] / 6) * 6;
      if (cur.xStarts.indexOf(xs) === -1) cur.xStarts.push(xs);
      cur.text += (cur.text && it.hasEOL ? ' ' : '') + str;
      if (it.hasEOL) flush();
    }
    flush();
    return lines;
  }

  function fontIsBold(fontName) {
    return /bold|black|heavy|(?:[-_ ]?(?:semi|extra|ultra)?(?:[23][05]0|[89]00|700|800|900))/i.test(String(fontName || ''));
  }

  /* ---------- heading heuristic ---------- */
  function headingInfo(line, baseline) {
    const base = baseline > 0 ? baseline : 11;
    const ratio = (line.avgSize || 0) / base;
    if (ratio >= 1.8) return { isHeading: true, level: 1, ratio };
    if (ratio >= 1.35) return { isHeading: true, level: 2, ratio };
    if (fontIsBold(line.fontName) && ratio >= 1.12) return { isHeading: true, level: 3, ratio };
    return { isHeading: false, level: 0, ratio };
  }

  /* ---------- table detection heuristic ---------- */
  function clusterStarts(line) {
    const xs = (line.xStarts || []);
    if (xs.length) {
      const rounded = xs.map((x) => Math.round(x / 8) * 8).filter((v, i, a) => a.indexOf(v) === i);
      return rounded;
    }
    return [];
  }

  function detectTable(lines) {
    if (!lines || !lines.length) {
      return { detected: false, reason: null, barRows: 0, columns: 0 };
    }
    const barRows = lines.filter((l) => (String(l.text).match(/\|/g) || []).length >= 2).length;
    const patternCounts = new Map();
    for (const line of lines) {
      const starts = clusterStarts(line);
      if (starts.length >= 3) {
        const pat = starts.join(',');
        patternCounts.set(pat, (patternCounts.get(pat) || 0) + 1);
      }
    }
    let repeating = 0;
    let bestPat = '';
    patternCounts.forEach((count, pat) => {
      if (count > repeating) { repeating = count; bestPat = pat; }
    });
    const columns = bestPat ? bestPat.split(',').length : 0;
    const detected = barRows >= 4 || (repeating >= 3 && columns >= 3);
    const reason = detected
      ? (barRows >= 4 ? 'explicit cell separators' : 'repeating column layout')
      : null;
    return { detected, reason, barRows, columns };
  }

  /* ---------- OCR-needed heuristic ---------- */
  function needsOcr(pageText) {
    return stripWs(pageText).length < OCR_MIN_TEXT;
  }

  /* ---------- caption detection ---------- */
  const CAPTION_PREFIX_RE = /^(figure|fig\.?|table|tab\.?|exhibit|photo|image|illustration|diagram|chart|panel)\b/i;

  function captionLike(text) {
    const t = normWs(text);
    return !!t && t.length <= IMAGE_CAPTION_MAX && CAPTION_PREFIX_RE.test(t);
  }

  /* ---------- page assembly ------------------------- */
  function pageFromUnits(units, ctx) {
    const flags = { table: !!(ctx.table && ctx.table.detected) || units.some((u) => u.type === 'table'), ocr: !!(ctx.ocrApplied || ctx.flagsOcr) };
    const text = units
      .map((u) => {
        if (u.type === 'heading' && u.text) return '## ' + u.text;
        if (u.type === 'image') return '[image]';
        if (u.type === 'table') return '[table] ' + u.text;
        return u.text || '';
      })
      .filter((t) => t !== '')
      .join('\n');
    return {
      pageNumber: ctx.pageNumber || 1,
      text,
      units,
      flags,
      imageCount: units.filter((u) => u.type === 'image').length,
      wordCount: countWords(text),
      ocrApplied: !!(ctx.ocrApplied || ctx.flagsOcr)
    };
  }

  function classifyLines(lines, ctx) {
    if (!lines) return [];
    const baseline = median(lines.map((l) => l.avgSize || 0));
    const units = [];
    let para = null;
    let paraTop = 0;
    let prevTop = null;

    const pushPara = () => {
      if (para) {
        units.push({ ...ctx, type: 'paragraph', top: paraTop, text: normWs(para) });
        para = null;
      }
    };

    for (const line of lines) {
      const text = normWs(line.text);
      if (!text) continue;
      const info = headingInfo(line, baseline);
      if (info.isHeading && text.length <= MAX_HEADING_LEN) {
        pushPara();
        units.push({ ...ctx, type: 'heading', headingLevel: info.level, fontSize: line.avgSize || 0, top: line.top, text });
        prevTop = line.top;
      } else {
        if (para && prevTop != null) {
          const gap = Math.abs(prevTop - line.top);
          if (gap >= (line.height || 11) * 1.8) pushPara();
        }
        if (!para) { para = ''; paraTop = line.top; }
        para += (para ? '\n' : '') + text;
        prevTop = line.top;
      }
    }
    pushPara();
    return units;
  }

  function interleaveWithImages(textUnits, images) {
    const items = [
      ...textUnits.map((u) => ({ u, y: typeof u.top === 'number' ? u.top : 0 })),
      ...(images || []).map((img) => ({ img, y: typeof img.y === 'number' ? img.y : 0 }))
    ].sort((a, b) => a.y - b.y);

    const ordered = [];
    for (const item of items) {
      if (item.img) {
        ordered.push({ ...item.img, type: 'image' });
      } else {
        ordered.push(item.u);
      }
    }
    return ordered;
  }

  function markCaptions(orderedUnits) {
    const out = [];
    for (let i = 0; i < orderedUnits.length; i++) {
      const u = orderedUnits[i];
      if (u.type === 'paragraph') {
        if (captionLike(u.text)) {
          out.push({ ...u, type: 'caption' });
          continue;
        }
        if (u.text.length <= IMAGE_CAPTION_MAX) {
          const nearImage = (i > 0 && orderedUnits[i - 1].type === 'image') || (i < orderedUnits.length - 1 && orderedUnits[i + 1].type === 'image');
          if (nearImage) {
            out.push({ ...u, type: 'caption' });
            continue;
          }
        }
      }
      out.push(u);
    }
    return out;
  }

  /**
   * Build a PDF page result from grouped lines + best-effort image list.
   * `images` entries: { y, width, height, dataUrl?, placeholder? }
   */
  function buildPage({ filename, sourceId, pageNumber, lines, images, table, ocrText, ocrApplied }) {
    const ctx = { sourceId: sourceId || filename, filename: filename || 'source', pageNumber: pageNumber || 1 };
    const textUnits = classifyLines(lines || [], ctx);
    let ordered = (interleaveWithImages(textUnits, images || [])).map((u) =>
      u.type === 'image' ? { ...ctx, ...u } : u
    );
    if (table && table.detected && table.reason) {
      ordered = [
        ...ordered.filter((u) => u.type !== 'table'),
        { ...ctx, type: 'table', flagged: true, reason: table.reason, text: cleanTableText(lines || []) }
      ];
    }
    ordered = markCaptions(ordered);
    const ocrOk = ocrApplied && ocrText && normWs(ocrText).length > 0;
    if (ocrOk) {
      ordered = [...ordered.filter((u) => u.type !== 'paragraph'), { ...ctx, type: 'paragraph', ocr: true, text: normWs(ocrText) }];
    }
    return pageFromUnits(ordered, { ...ctx, table, ocrApplied: ocrOk || null });
  }

  function cleanTableText(lines) {
    return (lines || []).map((l) => normWs(l.text)).filter(Boolean).join('\n');
  }

  /* ---------- mammoth HTML -> typed units ---------- */
  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  }

  function htmlToUnits(html, ctx) {
    const base = { sourceId: ctx.sourceId || ctx.filename || 'doc', filename: ctx.filename || 'doc', pageNumber: ctx.pageNumber || 1 };
    const units = [];
    let buffer = '';
    let blockType = 'paragraph';
    let top = 0;
    let bold = false;
    let italic = false;

    let inTable = false;
    let tableBuf = '';
    let tableBufRow = '';

    const flush = () => {
      const t = normWs(decodeEntities(buffer));
      buffer = '';
      if (!t) return;
      if (blockType === 'heading') {
        units.push({ ...base, type: 'heading', headingLevel: top || 2, text: t });
      } else {
        units.push({ ...base, type: 'paragraph', text: t });
      }
    };

    const tokenRe = /<\/?(?:[a-zA-Z][\w-]*)(?:\s[^<>]*)?\/?\s*>|&(?:#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);|[^<]+/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
      const token = m[0];
      if (token[0] === '&') {
        const decoded = decodeEntities(token);
        if (inTable) tableBufRow += decoded;
        else buffer += decoded;
        continue;
      }
      if (token[0] !== '<') {
        if (inTable) tableBufRow += token;
        else buffer += token;
        continue;
      }

      const isClose = token[1] === '/';
      const tagname = (token.match(/^<\/?([a-zA-Z][\w-]*)/) || [])[1] || '';
      const lower = tagname.toLowerCase();
      const headRe = /^h([1-6])$/.exec(lower);

      if (isClose) {
        if (headRe) { flush(); }
        else if (lower === 'p' || lower === 'blockquote' || lower === 'li') { flush(); }
        else if (lower === 'tr') { if (inTable) { tableBufRow = normWs(tableBufRow); tableBuf += (tableBuf ? '\n' : '') + tableBufRow; tableBufRow = ''; } }
        else if (lower === 'table') {
          if (inTable) {
            tableBufRow = normWs(tableBufRow);
            if (tableBufRow) tableBuf += (tableBuf ? '\n' : '') + tableBufRow;
            tableBufRow = '';
            const t = normWs(tableBuf);
            if (t) units.push({ ...base, type: 'table', flagged: true, reason: 'docx table - needs manual review', text: t });
            tableBuf = '';
            inTable = false;
          }
        }
        else if (lower === 'b' || lower === 'strong') { if (bold) { buffer += '**'; bold = false; } }
        else if (lower === 'i' || lower === 'em') { if (italic) { buffer += '*'; italic = false; } }
        continue;
      }

      /* opening tag */
      if (headRe) {
        flush();
        blockType = 'heading';
        top = parseInt(headRe[1], 10);
        continue;
      }
      if (lower === 'p' || lower === 'blockquote') { flush(); blockType = 'paragraph'; continue; }
      if (lower === 'li') { flush(); blockType = 'paragraph'; continue; }
      if (lower === 'br') { buffer += '\n'; continue; }
      if (lower === 'table') { flush(); inTable = true; tableBuf = ''; tableBufRow = ''; continue; }
      if (lower === 'tr') { continue; }
      if (lower === 'td' || lower === 'th') { tableBufRow += ' | '; continue; }
      if (lower === 'img') {
        flush();
        const attrs = {};
        const attrRe = /([\w-]+)="([^"]*)"/g;
        let am;
        while ((am = attrRe.exec(token)) !== null) attrs[am[1].toLowerCase()] = am[2];
        const w = parseInt(attrs.width || '0', 10) || 0;
        const h = parseInt(attrs.height || '0', 10) || 0;
        if (inTable) tableBufRow += '[image]';
        else units.push({ ...base, type: 'image', placeholder: true, width: w, height: h, top: top || 0, text: '' });
        continue;
      }
      if (lower === 'b' || lower === 'strong') { if (!bold) { buffer += '**'; bold = true; } continue; }
      if (lower === 'i' || lower === 'em') { if (!italic) { buffer += '*'; italic = true; } continue; }
      if (lower === 'br') { buffer += '\n'; continue; }
      /* div/span/a: ignore wrapper, content flows into buffer */
    }
    flush();
    return units;
  }

  function docxToPage(html, ctx) {
    const units = htmlToUnits(html, ctx);
    return pageFromUnits(units, { ...ctx, table: { detected: units.some((u) => u.type === 'table') } });
  }

  /* ---------- generic text files ---------- */
  function textPageUnits(text, ctx) {
    const base = { sourceId: ctx.sourceId || ctx.filename || 'text', filename: ctx.filename || 'text', pageNumber: ctx.pageNumber || 1 };
    const units = [];
    const paras = String(text || '').split(/\r?\n\s*\r?\n/);
    for (const p of paras) {
      const t = normWs(p.replace(/\r?\n+/g, ' '));
      if (t) units.push({ ...base, type: 'paragraph', text: t });
    }
    if (!units.length) units.push({ ...base, type: 'paragraph', text: '' });
    return units;
  }

  return {
    OCR_MIN_TEXT,
    groupLines,
    headingInfo,
    fontIsBold,
    detectTable,
    needsOcr,
    classifyLines,
    buildPage,
    pageFromUnits,
    htmlToUnits,
    docxToPage,
    textPageUnits,
    captionLike,
    normWs,
    countWords
  };
});