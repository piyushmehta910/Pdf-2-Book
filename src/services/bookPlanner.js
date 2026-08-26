/**
 * BookPlanner — turns the KB digest into a chapter plan BEFORE any prose (§17).
 * AI path returns strict JSON; deterministic fallback groups by relationship
 * density and keyword clusters so the app fully works without a key.
 */
const aiProvider = require('./aiProvider');
const { getPreset } = require('./bookPresets');
const { parseJsonLoose, isStr, isArr, isObj, strArray } = require('./jsonUtils');

const PLAN_SYSTEM =
  'You are a master non-fiction book architect. You receive a KNOWLEDGE DIGEST of canonical topics extracted from one or more documents. Group related topics into chapters ordered from foundational to advanced (respect prerequisite relationships implied by related-topic links). Never invent subject matter absent from the digest. Reply with STRICT JSON only, shaped exactly: {"title":string,"subtitle":string,"preface":string,"chapters":[{"title":string,"purpose":string,"topicIds":[string]}]}. Every topic id must appear in exactly one chapter. Provide 4-10 chapters.';

function sanitizePlan(raw, fallback) {
  const out = fallback;
  if (!isObj(raw)) return out;
  if (isStr(raw.title)) out.title = raw.title.trim().slice(0, 160);
  if (isStr(raw.subtitle)) out.subtitle = raw.subtitle.trim().slice(0, 200);
  if (isStr(raw.preface)) out.preface = raw.preface.trim().slice(0, 4000);
  if (isArr(raw.chapters)) {
    const known = new Set(out.__topicIds || []);
    const chapters = [];
    for (const ch of raw.chapters) {
      if (!isObj(ch) || !isStr(ch.title)) continue;
      const ids = strArray(ch.topicIds, 40).filter((id) => known.has(id));
      if (!ids.length) continue;
      chapters.push({
        title: ch.title.trim().slice(0, 140),
        purpose: isStr(ch.purpose) ? ch.purpose.trim().slice(0, 300) : '',
        topicIds: ids
      });
      if (chapters.length >= 12) break;
    }
    if (chapters.length >= 2) out.chapters = chapters;
  }
  delete out.__topicIds;
  return out;
}

/** Deterministic grouping: relationship-linked topics form connected clusters. */
function fallbackPlan(digest, title) {
  const nodes = (isArr(digest) ? digest : []).map((d) => ({ ...d }));
  const byName = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  for (const node of nodes) {
    for (const rel of node.related || []) {
      const neighbour = byName.get(String(rel).toLowerCase());
      if (neighbour && neighbour.id !== node.id) union(node.id, neighbour.id);
    }
  }

  const groups = new Map();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }

  // order clusters: biggest/most-sourced first becomes foundational-ish
  const clusters = [...groups.values()].sort((a, b) => b.length - a.length);

  const chapters = clusters.slice(0, 10).map((cluster) => ({
    title: cluster[0].name,
    purpose: `Covers ${cluster.map((c) => c.name).join(', ')}.`,
    topicIds: cluster.map((c) => c.id)
  }));

  // leftovers beyond 10 chapters get appended to the last chapter
  const overflow = clusters.slice(10).flat();
  if (overflow.length && chapters.length) {
    chapters[chapters.length - 1].topicIds.push(...overflow.map((c) => c.id));
  }
  if (!chapters.length) {
    chapters.push({ title: 'Findings', purpose: 'All extracted knowledge.', topicIds: [] });
  }

  return {
    title: title || 'Knowledge Book',
    subtitle: '',
    preface: '',
    chapters
  };
}

async function planFromDigest({ title, digest, presetId }, aiConfig) {
  const preset = getPreset(presetId);
  const safeDigest = isArr(digest) ? digest : [];
  const fb = fallbackPlan(safeDigest, title);
  fb.__topicIds = new Set(safeDigest.map((d) => d.id));

  if (!aiProvider.available(aiConfig)) {
    delete fb.__topicIds;
    return { plan: finalizeFallback(fb), mode: 'fallback' };
  }

  try {
    const digestBlock = JSON.stringify(safeDigest.slice(0, 90));
    const userParts = [
      `WORKING TITLE: ${title || 'Untitled'}`,
      `PRESET: ${preset.label} — ${preset.blueprintAddendum || ''}`,
      `KNOWLEDGE DIGEST (${safeDigest.length} topics): ${digestBlock}`
    ].join('\n\n');
    const raw = await aiProvider.complete(
      PLAN_SYSTEM,
      userParts.join('\n\n'),
      { maxTokens: 2000, temperature: 0.4, timeoutMs: 30000 },
      aiConfig
    );
    return { plan: sanitizePlan(parseJsonLoose(raw), fb), mode: 'ai' };
  } catch (_err) {
    delete fb.__topicIds;
    return { plan: finalizeFallback(fb), mode: 'fallback' };
  }
}

function finalizeFallback(fb) {
  const clean = { title: fb.title, subtitle: fb.subtitle || '', preface: fb.preface || '', chapters: [] };
  for (const ch of fb.chapters || []) {
    clean.chapters.push({ title: ch.title, purpose: ch.purpose || '', topicIds: ch.topicIds || [] });
  }
  return clean;
}

module.exports = { planFromDigest, fallbackPlan, sanitizePlan, PLAN_SYSTEM };
