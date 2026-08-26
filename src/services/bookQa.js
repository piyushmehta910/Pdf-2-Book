/**
 * BookQa — deterministic quality gate before export (master spec §29).
 * Pure function over the final book JSON + KB. No AI.
 */
const { isStr, isArr, isObj } = require('./jsonUtils');

function runQa(book, kb) {
  const errors = [];
  const warnings = [];
  const stats = {
    topics: kb && Array.isArray(kb.topics) ? kb.topics.filter((t) => !t.excluded).length : 0,
    chapters: 0,
    sections: 0,
    blocks: 0,
    conflicts: (kb && Array.isArray(kb.conflicts) ? kb.conflicts.filter((c) => c.status === 'unresolved').length : 0),
    unresolved_references: (kb && Array.isArray(kb.unresolved_refs) ? kb.unresolved_refs.length : 0),
    emptySections: 0,
    duplicateSections: 0,
    brokenRefs: 0
  };

  if (!isObj(book) || !isArr(book.chapters)) {
    return { status: 'fail', errors: ['Book JSON is malformed or missing chapters'], warnings, statistics: stats };
  }

  stats.chapters = book.chapters.length;
  if (!stats.chapters) errors.push('Book has no chapters');

  const seenSectionTitles = new Map();

  for (const ch of book.chapters) {
    if (!isStr(ch.title)) errors.push('Chapter without a title');
    else if (!ch.title.trim()) errors.push(`Empty chapter title`);
    const sections = isArr(ch.sections) ? ch.sections : [];
    if (!sections.length) errors.push(`Chapter "${ch.title || '?'}" has no sections`);

    for (const sec of sections) {
      stats.sections++;
      const blocks = isArr(sec.blocks) ? sec.blocks : [];
      if (!blocks.length) {
        stats.emptySections++;
        warnings.push(`Empty section "${sec.title || '?'}" in ${ch.title}`);
      }
      stats.blocks += blocks.length;

      const key = isStr(sec.title) ? sec.title.trim().toLowerCase() : '';
      if (key) {
        if (seenSectionTitles.has(key)) {
          stats.duplicateSections++;
          warnings.push(`Duplicate section title "${sec.title}" (${seenSectionTitles.get(key)} & ${ch.title})`);
        } else {
          seenSectionTitles.set(key, ch.title);
        }
      }

      // cross-reference integrity: [[Topic]] mentions must exist as topics
      for (const b of blocks) {
        const text = [b.text, b.content, ...(b.items || [])].filter(isStr).join(' ');
        const refs = text.match(/\[\[([^\]]+)\]\]/g) || [];
        for (const r of refs) {
          const name = r.slice(2, -2).trim().toLowerCase();
          const known = (kb && Array.isArray(kb.topics) ? kb.topics : []).some(
            (t) => !t.excluded &&
              (t.canonical_name.toLowerCase() === name || (t.aliases || []).some((a) => a.toLowerCase() === name))
          );
          if (!known) {
            stats.brokenRefs++;
            warnings.push(`Cross-reference "${r}" does not match any knowledge topic`);
          }
        }
      }
    }
  }

  // front/back matter checks
  if (!book.glossary || !book.glossary.length) warnings.push('No glossary entries were generated');
  if (book.meta && book.meta.includeToc && !book.tocEntries) warnings.push('Table of contents requested but missing');
  if (stats.unresolved_references > 20) {
    warnings.push(`${stats.unresolved_references} unresolved references remain — consider reviewing the Knowledge Manager`);
  }

  // spec new-field checks
  let openQCount = 0;
  let relMapCount = 0;
  let importanceCount = 0;
  for (const ch of (book.chapters || [])) {
    for (const sec of (ch.sections || [])) {
      for (const b of (sec.blocks || [])) {
        if (b.type === 'relationship_map') relMapCount++;
        if (b.type === 'importance') importanceCount++;
      }
    }
    openQCount += (ch.openQuestions || []).length;
  }
  if (!openQCount) warnings.push('No open questions surfaced by the writer — continuity may be thin');
  if (relMapCount === 0 && stats.topics >= 5) warnings.push('No relationship maps generated despite multiple topics');

  const status = errors.length ? 'fail' : warnings.length ? 'warn' : 'pass';
  return { status, errors, warnings, statistics: stats };
}

module.exports = { runQa };
