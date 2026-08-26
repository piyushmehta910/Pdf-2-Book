/**
 * SemanticResolver — deterministic-first topic identity resolution.
 *
 * Resolution ladder (master spec §7):
 *   1. normalized exact match against canonical names and aliases
 *   2. vector similarity (TF-IDF style term vectors; our embedding layer)
 *   3. confidence bands decide: auto-merge / strong candidate / AI adjudication / new
 *
 * Never merges on name similarity alone — the score bands are configurable.
 */
const { termVector, cosineSimilarity } = require('./similarity');

const THRESHOLDS = {
  AUTO_MERGE: 0.95,     // >= : same topic, merge automatically
  STRONG: 0.85,         // >= : strong candidate, treat as same, flag provenance
  REVIEW: 0.70,         // >= : ambiguous -> send to AI adjudication endpoint
  // < REVIEW          :    likely a new topic
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ies$/, 'y')
    .replace(/([^s])s$/, '$1');
}

/** Topic signature text used for similarity comparisons. */
function topicSignature(topic) {
  return [topic.canonical_name]
    .concat(topic.aliases || [])
    .concat([topic.summary || ''])
    .concat((topic.definitions || []).map((d) => d.text || '').slice(0, 4))
    .concat((topic.facts || []).map((f) => f.text || '').slice(0, 6))
    .concat((topic.terminology || []).map((t) => t.term || '').slice(0, 8))
    .join(' ');
}

/** Exact canonical/alias hit. Returns the topic or null. */
function exactMatch(kb, name) {
  const target = normalizeName(name);
  if (!target) return null;
  for (const topic of kb.topics) {
    if (normalizeName(topic.canonical_name) === target) return { topic, via: 'canonical' };
    for (const alias of topic.aliases || []) {
      if (normalizeName(alias) === target) return { topic, via: 'alias' };
    }
  }
  return null;
}

function bestSimilar(kb, text, excludeId) {
  const tv = termVector(text);
  if (!tv.size) return { topic: null, score: 0 };
  let best = null;
  let bestScore = 0;
  for (const topic of kb.topics) {
    if (excludeId && topic.id === excludeId) continue;
    const score = cosineSimilarity(tv, termVector(topicSignature(topic)));
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return { topic: best, score: Number(bestScore.toFixed(4)) };
}

/**
 * Resolve an incoming topic mention against the KB.
 * @returns {{verdict:'exact'|'strong'|'review'|'new', topic:Object|null, score:number, via?:string}}
 */
function resolveTopic(kb, name, contextText) {
  const probe = String(contextText || name || '');
  const hit = exactMatch(kb, name);
  if (hit) return { verdict: 'exact', topic: hit.topic, score: 1, via: hit.via };

  const sim = bestSimilar(kb, probe);
  if (!sim.topic) return { verdict: 'new', topic: null, score: 0 };

  if (sim.score >= THRESHOLDS.AUTO_MERGE) return { verdict: 'exact', topic: sim.topic, score: sim.score, via: 'vector' };
  if (sim.score >= THRESHOLDS.STRONG) return { verdict: 'strong', topic: sim.topic, score: sim.score, via: 'vector' };
  if (sim.score >= THRESHOLDS.REVIEW) return { verdict: 'review', topic: sim.topic, score: sim.score, via: 'vector' };
  return { verdict: 'new', topic: null, score: sim.score };
}

function needsAdjudication(resolution) {
  return resolution.verdict === 'review';
}

function classify(score) {
  if (score >= THRESHOLDS.AUTO_MERGE) return { verdict: 'same', action: 'auto-merge' };
  if (score >= THRESHOLDS.STRONG) return { verdict: 'same', action: 'merge-with-provenance' };
  if (score >= THRESHOLDS.REVIEW) return { verdict: 'related?', action: 'ai-adjudication' };
  return { verdict: 'new', action: 'create-topic' };
}

module.exports = {
  THRESHOLDS,
  normalizeName,
  topicSignature,
  exactMatch,
  bestSimilar,
  resolveTopic,
  needsAdjudication,
  classify
};
