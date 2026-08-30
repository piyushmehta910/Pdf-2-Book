/**
 * BookQa — deterministic quality audit engine before export (master spec §29, §33, §34).
 * Calculates a comprehensive 0-100 Quality Score, detecting structural issues,
 * empty sections, broken cross-references, ungrounded claims, and formatting flaws.
 */
const { isStr, isArr, isObj } = require('./jsonUtils');

function runQa(book, kb) {
  const errors = [];
  const warnings = [];
  const suggestions = [];

  const stats = {
    topics: kb && Array.isArray(kb.topics) ? kb.topics.filter((t) => !t.excluded).length : 0,
    chapters: 0,
    sections: 0,
    blocks: 0,
    conflicts: (kb && Array.isArray(kb.conflicts) ? kb.conflicts.filter((c) => c.status === 'unresolved').length : 0),
    unresolved_references: (kb && Array.isArray(kb.unresolved_refs) ? kb.unresolved_refs.length : 0),
    emptySections: 0,
    duplicateSections: 0,
    brokenRefs: 0,
    groundedBlocks: 0,
    formulas: 0,
    definitions: 0,
    examples: 0,
    exercises: 0,
    tables: 0
  };

  if (!isObj(book) || !isArr(book.chapters)) {
    return {
      status: 'fail',
      score: 0,
      errors: ['Book JSON is malformed or missing chapters'],
      warnings,
      suggestions,
      statistics: stats
    };
  }

  stats.chapters = book.chapters.length;
  if (!stats.chapters) errors.push('Book has no chapters');

  const seenSectionTitles = new Map();

  for (const ch of book.chapters) {
    if (!isStr(ch.title)) errors.push('Chapter without a title');
    else if (!ch.title.trim()) errors.push('Empty chapter title');
    const sections = isArr(ch.sections) ? ch.sections : [];
    if (!sections.length) errors.push(`Chapter "${ch.title || '?'}" has no sections`);

    for (const sec of sections) {
      stats.sections++;
      const blocks = isArr(sec.blocks) ? sec.blocks : [];
      if (!blocks.length) {
        stats.emptySections++;
        warnings.push(`Empty section "${sec.title || '?'}" in chapter "${ch.title}"`);
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

      for (const b of blocks) {
        if (b.sourceRef) stats.groundedBlocks++;
        if (b.type === 'formula') stats.formulas++;
        if (b.type === 'definition') stats.definitions++;
        if (b.type === 'example') stats.examples++;
        if (b.type === 'exercise') stats.exercises++;
        if (b.type === 'table') stats.tables++;

        // Cross-reference integrity: [[Topic]] mentions must exist as topics
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
            warnings.push(`Cross-reference "${r}" does not match any known topic in the knowledge base`);
          }
        }
      }
    }
  }

  // Front & Back matter checks
  if (!book.glossary || !book.glossary.length) warnings.push('No glossary entries were generated');
  if (book.meta && book.meta.includeToc && !book.tocEntries) warnings.push('Table of contents requested but missing');

  if (stats.conflicts > 5) {
    warnings.push(`${stats.conflicts} unresolved conflicting claims detected between source documents`);
  } else if (stats.conflicts > 0) {
    suggestions.push(`${stats.conflicts} unresolved conflict(s) detected. Consider reviewing in Knowledge Manager.`);
  }

  if (stats.unresolved_references > 20) {
    warnings.push(`${stats.unresolved_references} unresolved references remain — consider reviewing the Knowledge Manager`);
  }

  // Spec relationship map check
  let relMapCount = 0;
  for (const ch of (book.chapters || [])) {
    for (const sec of (ch.sections || [])) {
      for (const b of (sec.blocks || [])) {
        if (b.type === 'relationship_map') relMapCount++;
      }
    }
  }
  if (relMapCount === 0 && stats.topics >= 5) {
    warnings.push('No relationship maps generated despite multiple topics');
  }

  // Suggestions for enriched book structure
  if (!book.preface) {
    suggestions.push('Add a Preface to outline the book scope and target audience.');
  }

  // Calculate 0-100 Quality Score
  let score = 100;
  score -= (errors.length * 25);
  score -= (stats.emptySections * 10);
  score -= (stats.duplicateSections * 5);
  score -= (stats.brokenRefs * 3);
  score -= Math.min(15, stats.conflicts * 2);
  score = Math.max(0, Math.min(100, score));

  const status = errors.length ? 'fail' : warnings.length ? 'warn' : 'pass';

  return {
    status,
    score,
    errors,
    warnings,
    suggestions,
    statistics: stats
  };
}

module.exports = { runQa };
