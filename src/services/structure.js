/**
 * structure.js — book structure engine (master spec phase: front matter, chapters,
 * back matter, live TOC).
 *
 * A structure is the editable skeleton of a book BEFORE prose is written:
 *   { title, bookType, frontMatter[], chapters[], backMatter[], toc[] }
 *
 * - frontMatter/backMatter entries are book-type-aware defaults (driven by the
 *   preset `include` flags) that the user can enable/disable/reorder.
 * - chapters are deterministic topic clusters proposed from the knowledge base;
 *   each chapter carries sections (one per topic) that the writer fills later.
 * - buildToc derives the table of contents LIVE from the current structure so
 *   the client can re-render it on every structural edit without a server call.
 */
const { id } = require('./storage');
const { getPreset } = require('./bookPresets');
const { textSimilarity } = require('./similarity');

const SECTION_ORDER = [
  'introduction', 'foundations', 'definition', 'background', 'history',
  'mechanism', 'method', 'methodology', 'evidence', 'results', 'analysis',
  'application', 'treatment', 'practice', 'discussion',
  'limitation', 'risk', 'future'
];

function sectionRank(topicName) {
  const lower = String(topicName || '').toLowerCase();
  for (let i = 0; i < SECTION_ORDER.length; i += 1) {
    if (lower.includes(SECTION_ORDER[i])) return i;
  }
  return SECTION_ORDER.length;
}

/**
 * Book-type-aware default front/back matter from the preset include flags.
 * cover + toc are always present; the rest follow `preset.include`.
 */
function defaultMatter(bookType) {
  const preset = getPreset(bookType);
  const inc = preset.include || {};

  const frontMatter = [
    { id: id('fm'), type: 'cover', title: 'Cover Page', enabled: true },
    { id: id('fm'), type: 'preface', title: 'Preface', enabled: true, content: '', note: 'Briefly introduce the book and what the reader will learn.' },
    { id: id('fm'), type: 'toc', title: 'Table of Contents', enabled: true }
  ];

  const backMatter = [];
  if (inc.sources !== false) {
    backMatter.push({ id: id('bm'), type: 'references', title: 'References', enabled: true, note: 'Full bibliography generated from source documents.' });
  }
  if (inc.glossary === true) {
    backMatter.push({ id: id('bm'), type: 'glossary', title: 'Glossary', enabled: true, note: 'Key terms and definitions extracted from your sources.' });
  }
  if (inc.index === true) {
    backMatter.push({ id: id('bm'), type: 'index', title: 'Index', enabled: true, note: 'Alphabetical topic index generated from the structure.' });
  }

  return { frontMatter, backMatter };
}

function sanitizeTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return topics
    .filter((t) => t && typeof t === 'object' && (t.id || t.name))
    .slice(0, 200)
    .map((t) => ({
      id: String(t.id || '').slice(0, 80) || `top_${Math.random().toString(36).slice(2, 8)}`,
      name: String(t.name || 'Untitled').slice(0, 160),
      keywords: Array.isArray(t.keywords) ? t.keywords.map((k) => String(k)) : [],
      chunkIds: Array.isArray(t.chunkIds) ? t.chunkIds.map(String) : [],
      sources: Array.isArray(t.sources) ? t.sources.map(String) : [],
      sections: Array.isArray(t.sections) ? t.sections.map(String) : [],
      chunkCount: Number(t.chunkCount) || 0,
      summary: String(t.summary || '').slice(0, 600)
    }));
}

/** Deterministic relatedness: shared source + keyword overlap, or near-identical names. */
function linkKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function topicsLinked(a, b) {
  const sharedSource = (a.sources || []).some((s) => (b.sources || []).includes(s));
  const kwA = new Set((a.keywords || []).map((k) => linkKey(k)).filter(Boolean));
  const kwB = new Set((b.keywords || []).map((k) => linkKey(k)).filter(Boolean));
  let overlap = 0;
  kwA.forEach((k) => { if (kwB.has(k)) overlap += 1; });
  if (sharedSource && overlap > 0) return true;
  const na = linkKey(a.name);
  const nb = linkKey(b.name);
  if (na && nb && (na === nb || textSimilarity(na, nb) >= 0.55)) return true;
  return false;
}

/** Union-find over topics; clusters may still need splitting into chapters. */
function unionClusters(topics) {
  const parent = new Map(topics.map((t) => [t.id, t.id]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  for (let a = 0; a < topics.length; a += 1) {
    for (let b = a + 1; b < topics.length; b += 1) {
      if (topicsLinked(topics[a], topics[b])) parent.set(find(topics[a].id), find(topics[b].id));
    }
  }
  const groups = new Map();
  for (const t of topics) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()];
}

function sortTopicsForOrder(topics) {
  return [...topics].sort((a, b) => {
    const r = sectionRank(a.name) - sectionRank(b.name);
    if (r !== 0) return r;
    return (b.chunkCount || 0) - (a.chunkCount || 0);
  });
}

function clusterToChapters(cluster) {
  const ordered = sortTopicsForOrder(cluster);
  const chapters = [];
  const size = 6;
  for (let i = 0; i < ordered.length; i += size) {
    const group = ordered.slice(i, i + size);
    const lead = [...group].sort((a, b) => (b.chunkCount || 0) - (a.chunkCount || 0))[0] || group[0];
    chapters.push({
      id: id('ch'),
      title: lead ? lead.name : 'Untitled Chapter',
      purpose: `Covers ${group.map((c) => c.name).join(', ')}.`,
      topicIds: group.map((c) => c.id),
      count: group.map((c) => c.chunkCount || 0).reduce((sum, n) => sum + n, 0),
      sections: group.map((c) => ({
        id: id('sec'),
        title: c.name,
        topicId: c.id,
        purpose: (c.summary || '').slice(0, 240),
        blocks: []
      }))
    });
  }
  return chapters;
}

/**
 * Propose a full book structure from processed topics (deterministic).
 * Returns { title, bookType, frontMatter, chapters, backMatter, toc, mode, stats }.
 */
function proposeStructure({ topics, bookType, title, subtitle }) {
  const clean = sanitizeTopics(topics);
  const matter = defaultMatter(bookType);
  let chapters = [];

  if (clean.length) {
    const unions = unionClusters(clean)
      .sort((a, b) => {
        const sa = a.reduce((s, t) => s + (t.chunkCount || 0), 0);
        const sb = b.reduce((s, t) => s + (t.chunkCount || 0), 0);
        return sb - sa;
      });
    for (const cluster of unions) chapters.push(...clusterToChapters(cluster));
    // number the chapters in order
    chapters = chapters.map((ch, i) => ({ ...ch, number: i + 1 }));
  }

  const structure = {
    title: String(title || 'Untitled Book').slice(0, 160),
    subtitle: String(subtitle || '').slice(0, 200),
    bookType: bookType || getPreset(null).id,
    frontMatter: matter.frontMatter,
    chapters,
    backMatter: matter.backMatter
  };

  return {
    ...structure,
    toc: buildToc(structure),
    mode: 'fallback',
    stats: {
      topics: clean.length,
      chapters: chapters.length,
      sections: chapters.reduce((sum, c) => sum + (c.sections || []).length, 0),
      frontMatter: matter.frontMatter.length,
      backMatter: matter.backMatter.length
    }
  };
}

/**
 * Live table of contents derived from the current structure.
 * Each entry: { id, level: 'front'|'chapter'|'section'|'back', label, target, number? }.
 */
function buildToc(structure) {
  const entries = [];
  for (const f of Array.isArray(structure && structure.frontMatter) ? structure.frontMatter : []) {
    if (f && f.enabled !== false) {
      entries.push({ id: f.id, level: 'front', type: f.type || 'front', label: f.title || 'Front Matter', target: f.id, number: null });
    }
  }
  for (const ch of Array.isArray(structure && structure.chapters) ? structure.chapters : []) {
    if (!ch) continue;
    entries.push({ id: ch.id, level: 'chapter', label: ch.title || 'Chapter', target: ch.id, number: ch.number || null });
    for (const s of Array.isArray(ch.sections) ? ch.sections : []) {
      if (!s || !s.title) continue;
      entries.push({ id: s.id, level: 'section', label: s.title, target: s.id, number: null });
    }
  }
  for (const b of Array.isArray(structure && structure.backMatter) ? structure.backMatter : []) {
    if (b && b.enabled !== false) {
      entries.push({ id: b.id, level: 'back', type: b.type || 'back', label: b.title || 'Back Matter', target: b.id, number: null });
    }
  }
  return entries;
}

module.exports = { defaultMatter, proposeStructure, buildToc, sanitizeTopics, unionClusters };