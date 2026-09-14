/**
 * knowledgePipeline.js — orchestrates the knowledge-processing layer over
 * extracted content (typed units or raw page text).
 *
 *  sources -> chunks -> embeddings -> duplicates -> topic clusters -> conflicts -> outline
 *
 * Every chunk keeps { sourceId, pageNumber, section } so citations upstream
 * and evidence downstream never lose the link.
 */
const { chunkDocument, chunkUnits } = require('./chunker');
const { detectDuplicates } = require('./duplicateDetector');
const { detectConflictsFromClusters } = require('./conflictDetector');
const { buildOutline } = require('./outlineBuilder');
const { makeLocalEmbedder, resolveSyncEmbedder } = require('./embeddings');
const { id } = require('./storage');
const { topKeywords } = require('./similarity');

/** Flatten one source payload into chunks. Uses typed units when present. */
function chunksFromSource(source) {
  const sourceId = source.id || source.sourceId || source.document_id || 'src';
  const out = [];
  for (const page of Array.isArray(source.pages) ? source.pages : []) {
    const pageNumber = Number(page.pageNumber) || 1;
    if (Array.isArray(page.units) && page.units.length) {
      out.push(...chunkUnits(page.units, { sourceId, pageNumber }));
    } else {
      const md = page.markdown || page.text || '';
      if (md.trim()) out.push(...chunkDocument(sourceId, [{ pageNumber, text: md, section: page.section }]));
    }
  }
  return out.map((c, index) => ({ ...c, index, tokenCount: c.content.split(/\s+/).length }));
}

function buildChunks(sources) {
  const all = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    all.push(...chunksFromSource(source));
  }
  return all;
}

/**
 * Greedy embedding clustering. `embedder` must offer a sync `.embed(texts)`
 * facade (see resolveSyncEmbedder); `vectors` are precomputed and aligned with
 * `chunks`, so no re-embedding happens here.
 */
function clusterChunks(chunks, embedder, opts, vectors) {
  const o = opts || {};
  const clusterThreshold = typeof o.clusterThreshold === 'number' ? o.clusterThreshold : 0.5;
  const mergeThreshold = typeof o.mergeThreshold === 'number' ? o.mergeThreshold : 0.72;
  const list = Array.isArray(chunks) ? chunks : [];
  const vecs = vectors || (embedder ? embedder.embed(list.map((c) => c.content || '')) : []);

  const clusters = []; // { ids: [], sumVectors: [], count }
  for (let i = 0; i < list.length; i++) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let c = 0; c < clusters.length; c++) {
      const centroid = clusters[c].sumVectors.map((v) => v / clusters[c].count);
      const s = embedder ? embedder.similarity(vecs[i], centroid) : 0;
      if (s >= clusterThreshold && s > bestScore) {
        bestScore = s;
        bestIdx = c;
      }
    }
    if (bestIdx < 0) {
      clusters.push({ ids: [i], sumVectors: (vecs[i] || new Array(vecs[0] ? vecs[0].length : 0).fill(0)).slice(), count: 1 });
    } else {
      const c = clusters[bestIdx];
      c.ids.push(i);
      const v = vecs[i];
      if (v) {
        for (let d = 0; d < c.sumVectors.length; d++) c.sumVectors[d] += v[d] || 0;
      }
      c.count++;
    }
  }

  // merge near-identical clusters by centroid similarity (only when vectors exist)
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const ca = clusters[a];
        const cb = clusters[b];
        const va = ca.sumVectors.map((x) => x / ca.count);
        const vb = cb.sumVectors.map((x) => x / cb.count);
        const s = embedder ? embedder.similarity(va, vb) : 0;
        if (s >= mergeThreshold && ca.count + cb.count > 2) {
          ca.ids.push(...cb.ids);
          ca.count += cb.count;
          for (let d = 0; d < ca.sumVectors.length; d++) ca.sumVectors[d] += cb.sumVectors[d] || 0;
          clusters.splice(b, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return clusters
    .filter((c) => c.ids.length)
    .map((c, ci) => {
      const members = c.ids.map((i) => list[i]).filter(Boolean);
      const sections = members.map((m) => m.section).filter((s) => s && s !== 'Body');
      const sectionCounts = new Map();
      for (const s of sections) sectionCounts.set(s, (sectionCounts.get(s) || 0) + 1);
      const dominant = [...sectionCounts.entries()].sort((x, y) => y[1] - x[1])[0];
      const keywords = topKeywords(members.map((m) => m.content), 6);
      const name = dominant
        ? dominant[0]
        : keywords.length
          ? keywords.slice(0, 3).map(cap).join(' ')
          : `Topic ${ci + 1}`;
      return {
        id: id('top'),
        name,
        keywords,
        chunkIds: members.map((m) => m.id),
        sources: [...new Set(members.map((m) => m.sourceId))],
        sections: [...new Set(sections)],
        chunkCount: members.length,
        summary: (members[0] ? members[0].content : '').slice(0, 500)
      };
    })
    .sort((a, b) => b.chunkIds.length - a.chunkIds.length);
}

function cap(text) {
  return String(text).replace(/(^|\s)([a-z])/g, (m, s, ch) => s + ch.toUpperCase());
}

/**
 * Full knowledge pass over a set of sources.
 * @param {object} input - { sources, aiConfig?, embedder? }
 */
async function processSources({ sources, embedder }) {
  const chunks = buildChunks(sources);
  const texts = chunks.map((c) => c.content || '');

  const local = embedder || makeLocalEmbedder();
  const { embedder: syncEmbedder, vectors } = await resolveSyncEmbedder(local, texts);

  const duplicates = detectDuplicates(chunks, { embedder: syncEmbedder, vectors, onlyAcrossSources: true });
  const topics = clusterChunks(chunks, syncEmbedder, null, vectors);
  const conflicts = detectConflictsFromClusters({ chunks, topics, duplicates }, { embedder: syncEmbedder, vectors });
  const outline = buildOutline(topics);

  return {
    chunks,
    topics,
    duplicates,
    conflicts,
    outline,
    embedMode: local.mode || 'local',
    stats: {
      sources: (Array.isArray(sources) ? sources : []).length,
      chunks: chunks.length,
      topics: topics.length,
      duplicateGroups: duplicates.length,
      conflicts: conflicts.length,
      chapters: (outline && outline.chapters ? outline.chapters : []).length
    }
  };
}

module.exports = { buildChunks, chunksFromSource, clusterChunks, processSources };