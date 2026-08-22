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

module.exports = { chunkPage, chunkDocument, splitParagraphs, splitLongText };
