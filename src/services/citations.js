/**
 * citations.js — the single citation model for the knowledge layer.
 *
 * Every AI-derived claim keeps a `citations` array of { sourceId, page, section }
 * so no generated text can silently lose its grounding. Server-side services
 * produce these; the client evidence panel consumes them.
 */

const { textSimilarity } = require('./similarity');

const INLINE_TAG_RE = /\[src\s*\(\s*(\d+)\s*\)\]|\[\s*(\d+)\s*\]/gi;

function normCitation(c) {
  if (!c) return null;
  const sourceId = c.sourceId || c.document_id || c.source || c.id || '';
  const pageRaw = c.page !== undefined ? c.page : c.pageNumber;
  const page = Number(pageRaw);
  return {
    sourceId: String(sourceId),
    page: Number.isFinite(page) && page > 0 ? page : 0,
    section: String(c.section || c.heading || '').slice(0, 120)
  };
}

function sourceRefToCitation(ref) {
  return normCitation(ref);
}

function sourceRefFromCitation(cit) {
  if (!cit) return null;
  return { document_id: cit.sourceId, page: cit.page, section: cit.section };
}

/** Merge + normalize an arbitrary list of citation-ish records, deduping. */
function normalizeCitations(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const c = normCitation(item);
    if (!c || !c.sourceId) continue;
    const key = `${c.sourceId}|${c.page}|${c.section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** turn an evidence array into its citation subset */
function citationsFromEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .map((e) => ({ sourceId: e.sourceId, page: e.page, section: e.section }))
    .filter((c) => c.sourceId);
}

function renderInlineCitation(cit, sourceLabel) {
  const label = (sourceLabel || cit.sourceId || 'source').slice(0, 60);
  const parts = [];
  if (cit.page) parts.push(`p. ${cit.page}`);
  if (cit.section && cit.section !== 'Body') parts.push(`sec. ${cit.section}`);
  return `[${label}${parts.length ? ', ' + parts.join(', ') : ''}]`;
}

/**
 * Strip inline [src(N)] / [N] tags from generated text (they were only a
 * scaffold for grounding, real citations live in block.citations).
 */
function stripInlineTags(text) {
  return String(text || '').replace(INLINE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Attach citations to generated blocks.
 *
 * Strategy:
 *  1. Numeric `citations:[1,2]` arrays on a block map back to evidence indexes.
 *  2. Inline [src(N)] markers inside block text map to evidence indexes too.
 *  3. Blocks with no markers get the strongest-matching evidence attached
 *     (lexical similarity) so nothing is left ungrounded.
 *
 * @param {Array} sections  generated blocks grouped in sections
 * @param {Array} evidence  list of { id?, sourceId, page, section, content }
 * @returns {Array} sections, each block augmented with `.citations`
 */
function attachCitations(sections, evidence, opts) {
  const o = opts || {};
  const threshold = typeof o.threshold === 'number' ? o.threshold : 0.14;
  const maxPerBlock = o.maxPerBlock || 4;
  const ev = Array.isArray(evidence) ? evidence : [];
  const indexOf = new Map();
  ev.forEach((e, i) => indexOf.set(e.id, i));

  const byIndex = (n) => {
    const idx = Number(n);
    const e = ev[idx - 1];
    if (e) return { sourceId: e.sourceId, page: e.page, section: e.section };
    return null;
  };

  const bestMatches = (text) => {
    if (!text) return [];
    const scored = ev
      .map((e) => ({ cit: { sourceId: e.sourceId, page: e.page, section: e.section }, score: textSimilarity(text, e.content || '') }))
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, maxPerBlock).map((m) => m.cit);
  };

  const merge = (blocks) => {
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      let cites = [];

      if (Array.isArray(b.citations)) {
        cites = b.citations.map((c) => (typeof c === 'number' ? byIndex(c) : normCitation(c))).filter(Boolean);
      } else if (b.citeIndexes) {
        cites = b.citeIndexes.map((n) => byIndex(n)).filter(Boolean);
      }

      if (b.sourceRef) {
        const c = sourceRefToCitation(b.sourceRef);
        if (c && c.sourceId) cites.push(c);
      }

      if (isTextBlock(b)) {
        const matches = String(b.text || '').match(INLINE_TAG_RE);
        if (matches) {
          for (const tag of matches) {
            const num = (tag.match(/\d+/) || [])[0];
            const c = num ? byIndex(num) : null;
            if (c) cites.push(c);
          }
          if (typeof b.text === 'string') b.text = stripInlineTags(b.text);
        }
        if (!cites.length) {
          cites = bestMatches(b.text || (b.definition || ''));
        }
      }

      b.citations = normalizeCitations(cites).slice(0, maxPerBlock);
      if (b.citations.length && !b.sourceRef) b.sourceRef = sourceRefFromCitation(b.citations[0]);
    }
    return blocks;
  };

  (Array.isArray(sections) ? sections : []).forEach((sec) => {
    if (sec && Array.isArray(sec.blocks)) merge(sec.blocks);
  });
  return sections;
}

function isTextBlock(b) {
  if (typeof b.text === 'string') return true;
  return typeof b.definition === 'string' || typeof b.expression === 'string';
}

/** Collect every distinct citation used across a book structure. */
function collectCitations(book) {
  const out = [];
  for (const ch of (Array.isArray(book && book.chapters) ? book.chapters : [])) {
    for (const sec of (ch.sections || [])) {
      for (const b of (sec.blocks || [])) {
        if (Array.isArray(b.citations)) out.push(...b.citations);
      }
    }
  }
  return normalizeCitations(out);
}

/** Annotate book chapters that came from generation with citation metadata. */
function annotateBookWithCitations(book) {
  if (!book || !Array.isArray(book.chapters)) return book;
  const citations = collectCitations(book);
  return { ...book, citations, citationCount: citations.length };
}

module.exports = {
  normCitation,
  sourceRefToCitation,
  sourceRefFromCitation,
  normalizeCitations,
  citationsFromEvidence,
  renderInlineCitation,
  stripInlineTags,
  attachCitations,
  collectCitations,
  annotateBookWithCitations
};