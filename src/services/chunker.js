const config = require('../config');
const { id } = require('./storage');

function splitParagraphs(markdown) {
  return markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitLongText(text, maxChars) {
  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function chunkPage(sourceId, pageNumber, markdown, sectionHint) {
  const { maxChars, minChars } = config.chunk;
  const paragraphs = splitParagraphs(markdown);
  const chunks = [];
  let buffer = '';
  const bufferHeadings = [];

  const flush = () => {
    if (!buffer.trim()) return;
    chunks.push({
      id: id('chk'),
      sourceId,
      pageNumber,
      section: bufferHeadings.length ? bufferHeadings[bufferHeadings.length - 1] : sectionHint || 'Body',
      content: buffer.trim()
    });
    buffer = '';
  };

  for (const para of paragraphs) {
    const headingMatch = para.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flush();
      bufferHeadings.push(headingMatch[2].trim());
      continue;
    }
    if (para.startsWith('<!-- page')) continue;

    if (para.length > maxChars) {
      flush();
      for (const piece of splitLongText(para, maxChars)) {
        chunks.push({
          id: id('chk'),
          sourceId,
          pageNumber,
          section: bufferHeadings.length ? bufferHeadings[bufferHeadings.length - 1] : sectionHint || 'Body',
          content: piece
        });
      }
      continue;
    }

    buffer += (buffer ? '\n\n' : '') + para;
    if (buffer.length >= maxChars) flush();
  }
  flush();

  const merged = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.section === chunk.section && prev.content.length + chunk.content.length < minChars * 2) {
      prev.content += '\n\n' + chunk.content;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

function chunkDocument(sourceId, pages) {
  const all = [];
  for (const page of pages) {
    const md = page.markdown || page.text || '';
    const pageChunks = chunkPage(sourceId, page.pageNumber, md, page.section);
    all.push(...pageChunks);
  }
  all.forEach((chunk, index) => {
    chunk.index = index;
    chunk.tokenCount = chunk.content.split(/\s+/).length;
  });
  return all;
}

/** Render one typed extracted unit to chunk text. */
function unitText(unit) {
  if (!unit) return '';
  const type = unit.type || 'paragraph';
  if (type === 'table') {
    return String(unit.text || '')
      .split('\n')
      .map((row) => row.replace(/\s*\|\s*/g, ' | '))
      .join('\n');
  }
  if (type === 'image') return unit.dataUrl ? '[[embedded image]]' : (unit.text || '[[embedded image]]');
  return String(unit.text || unit.term || unit.definition || '');
}

/**
 * Chunk typed extracted units (from PDF/DOCX/page review) into topic-sized
 * knowledge units. Each chunk keeps { sourceId, pageNumber, section } plus
 * the unit ids it was built from so evidence stays resolvable.
 */
function chunkUnits(units, { sourceId, pageNumber, maxChars } = {}) {
  maxChars = maxChars || config.chunk.maxChars;
  const input = Array.isArray(units) ? units : [];
  const chunks = [];
  let buffer = '';
  let bufferUnitIds = [];
  let section = 'Body';
  let bufferIsHeading = false;

  const push = (chunk) => chunks.push(chunk);

  const flush = () => {
    const content = buffer.trim();
    if (!content) { buffer = ''; bufferUnitIds = []; return; }
    push({
      id: id('chk'),
      sourceId,
      pageNumber,
      section,
      content,
      type: bufferIsHeading ? 'heading' : 'paragraph',
      unitIds: bufferUnitIds
    });
    buffer = '';
    bufferUnitIds = [];
    bufferIsHeading = false;
  };

  for (const u of input) {
    if (!u || typeof u !== 'object') continue;
    const type = u.type || 'paragraph';
    const text = unitText(u);

    if (type === 'heading') {
      if (text) {
        flush();
        section = text;
        push({ id: id('chk'), sourceId, pageNumber, section, content: text, type: 'heading', unitIds: [u.id] });
      }
      continue;
    }

    if (type === 'table' || type === 'image') {
      if (text) {
        flush();
        push({ id: id('chk'), sourceId, pageNumber, section, content: text, type, unitIds: [u.id] });
      }
      continue;
    }

    // paragraph / caption / definition / quote … accumulate
    if (text.length > maxChars) {
      flush();
      for (const piece of splitLongText(text, maxChars)) {
        push({ id: id('chk'), sourceId, pageNumber, section, content: piece, type: 'paragraph', unitIds: [u.id] });
      }
      continue;
    }
    if (!buffer) buffer = text;
    else buffer += '\n\n' + text;
    bufferUnitIds.push(u.id);
    if (buffer.length >= maxChars) flush();
  }
  flush();
  return chunks;
}

module.exports = { chunkPage, chunkDocument, chunkUnits, splitParagraphs, splitLongText, unitText };
