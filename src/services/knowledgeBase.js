/**
 * KnowledgeBase — the canonical source of truth (master spec §6, §14–16).
 *
 * A serializable plain object so the browser owns persistence (IndexedDB) and
 * stateless endpoints operate on slices. Every meaningful item carries
 * provenance {document_id, page}. Pure functions only; no I/O.
 */
const { isStr, isArr, isObj, strArray } = require('./jsonUtils');
const semanticResolver = require('./semanticResolver');
const { topKeywords } = require('./similarity');

let idCounter = 0;
function newId(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeRef(documentId, page, extra) {
  const ref = { document_id: String(documentId || 'doc'), page: Number(page) || 0 };
  if (extra && typeof extra === 'object') {
    if (isStr(extra.section)) ref.section = extra.section.slice(0, 80);
    if (typeof extra.confidence === 'number') ref.confidence = Math.max(0, Math.min(1, extra.confidence));
    if (isStr(extra.file_name)) ref.file_name = extra.file_name.slice(0, 160);
  }
  return ref;
}

const sameRef = (a, b) =>
  a && b && a.document_id === b.document_id && Number(a.page) === Number(b.page);

function createKb() {
  return {
    topics: [],
    conflicts: [],
    unresolved_refs: [],
    glossary: {},
    documents: []
  };
}

const MAX = {
  topics: 600,
  aliases: 12,
  definitions: 40,
  facts: 80,
  examples: 30,
  formulas: 25,
  procedures: 20,
  relationships: 40,
  terminology: 40,
  conflicts: 120,
  unresolved: 200,
  text: 900
};

function dedupeBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    let k;
    try { k = keyFn(item); } catch (_e) { k = null; }
    if (k == null) continue;
    const key = typeof k === 'string' ? k : JSON.stringify(k);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function clipText(v, cap) {
  return isStr(v) ? v.trim().slice(0, cap || MAX.text) : '';
}

/** Wrap arbitrary AI-provided items into {text, source_ref} records. */
function asRecords(input, ref, textFields) {
  const out = [];
  for (const raw of isArr(input) ? input : []) {
    let record = null;
    if (isStr(raw)) record = { text: raw.trim() };
    else if (isObj(raw)) {
      record = { text: '' };
      for (const f of textFields) {
        if (isStr(raw[f])) { record.text = raw[f].trim(); break; }
      }
      if (!record.text) {
        const joined = strArray(raw.items || raw.steps, 12);
        if (joined.length) record.text = joined.join(' | ');
      }
      for (const copyField of ['title', 'term', 'expression', 'name', 'meaning', 'note']) {
        if (isStr(raw[copyField])) record[copyField] = clipText(raw[copyField], 240);
      }
      if (!record.text && !record.term && !record.expression && !record.title) continue;
    }
    if (!record || !record.text) continue;
    record.text = clipText(record.text);
    record.source_ref = ref;
    out.push(record);
    if (out.length >= 24) break;
  }
  return out;
}

function blankTopic(name, ref) {
  return {
    id: newId('topic'),
    canonical_name: clipText(name, 140) || 'Unnamed topic',
    aliases: [],
    summary: '',
    definitions: [],
    facts: [],
    examples: [],
    formulas: [],
    procedures: [],
    relationships: [],
    terminology: [],
    entities: [],
    source_refs: [],
    first_seen: ref,
    last_updated: ref,
    confidence: 0.8,
    excluded: false
  };
}

function ensureTopic(kb, name, ref) {
  const resolution = semanticResolver.resolveTopic(kb, name, name);
  if (resolution.topic) {
    touchTopic(kb, resolution.topic, ref);
    return { topic: resolution.topic, created: false, resolution };
  }
  if (kb.topics.length >= MAX.topics) {
    // recycle the smallest topic slot deterministically: refuse politely
    return { topic: kb.topics[0], created: false, resolution: null };
  }
  const topic = blankTopic(name, ref);
  topic.source_refs.push(ref);
  kb.topics.push(topic);
  return { topic, created: true, resolution };
}

function touchTopic(_kb, topic, ref) {
  if (!ref) return;
  if (!topic.first_seen) topic.first_seen = ref;
  topic.last_updated = ref;
  if (!topic.source_refs.some((r) => sameRef(r, ref))) {
    topic.source_refs.push(ref);
    if (topic.source_refs.length > 60) topic.source_refs.shift();
  }
}

function pushUnique(list, records, cap) {
  const deduped = dedupeBy(records, (r) => (r.text || '').toLowerCase().slice(0, 160));
  for (const rec of deduped) {
    const exists = list.some((x) => (x.text || '').toLowerCase() === (rec.text || '').toLowerCase());
    if (!exists) list.push(rec);
  }
  if (list.length > cap) list.splice(0, list.length - cap);
}

/** Attach a fact/def/etc to the most similar existing topic (or given one). */
function bestTopicFor(kb, text, preferredId) {
  if (preferredId) {
    const pref = kb.topics.find((t) => t.id === preferredId);
    if (pref) return pref;
  }
  if (!kb.topics.length) return null;
  const { topic } = semanticResolver.bestSimilar(kb, text);
  return topic;
}

/**
 * Apply a validated extraction result (master prompt §8 schema) to the KB.
 * @returns {{stats:Object}} counts of what changed
 */
function applyExtraction(kb, extraction, meta) {
  const ref = makeRef(meta.document_id, meta.page, meta);
  const stats = {
    topicsCreated: 0,
    topicsUpdated: 0,
    definitionsAdded: 0,
    factsAdded: 0,
    examplesAdded: 0,
    formulasAdded: 0,
    proceduresAdded: 0,
    relationshipsAdded: 0,
    glossaryAdded: 0,
    conflictsAdded: 0,
    unresolvedAdded: 0,
    merged: 0
  };

  const ext = isObj(extraction) ? extraction : {};
  const pageTopics = strArray(ext.topics, 10);

  // 1) canonical topics mentioned on this page
  const pageTopicObjs = [];
  for (const name of pageTopics) {
    const { topic, created, resolution } = ensureTopic(kb, name, ref);
    if (created) stats.topicsCreated++;
    else if (resolution && resolution.verdict !== 'exact') stats.merged += resolution.verdict === 'strong' ? 1 : 0;
    if (!pageTopicObjs.includes(topic)) pageTopicObjs.push(topic);
    if (ext.page_summary && pageTopicObjs.indexOf(topic) === 0 && !topic.summary) {
      topic.summary = clipText(ext.page_summary, 700);
    }
  }

  const attach = (records, field, cap, statKey, preferFirstTopic) => {
    for (const rec of records) {
      let target;
      if (field === 'definitions' && isStr(rec.term)) {
        const hit = semanticResolver.exactMatch(kb, rec.term);
        target = hit ? hit.topic : (pageTopicObjs[0] || bestTopicFor(kb, rec.term + ' ' + rec.text));
      } else if (preferFirstTopic) {
        target = pageTopicObjs[0] || bestTopicFor(kb, rec.text);
      } else {
        // similarity first; when the text gives no signal, anchor to the
        // page's dominant topic so nothing is silently dropped
        target = bestTopicFor(kb, rec.text) || pageTopicObjs[0] || kb.topics[0];
      }
      if (!target) continue;
      pushUnique(target[field], [rec], cap);
      stats[statKey]++;
      touchTopic(kb, target, ref);
    }
  };

  // 2) definitions
  attach(
    asRecords(ext.definitions, ref, ['definition', 'text', 'meaning']),
    'definitions', MAX.definitions, 'definitionsAdded', true
  );

  // 3) facts / new information / updates -> facts
  attach(
    asRecords([].concat(ext.new_information, ext.key_facts), ref, ['fact', 'text', 'claim', 'information']),
    'facts', MAX.facts, 'factsAdded', false
  );

  // 4) examples / exceptions
  attach(asRecords(ext.examples, ref, ['example', 'text', 'content']), 'examples', MAX.examples, 'examplesAdded', false);

  // 5) formulas
  attach(asRecords(ext.formulas, ref, ['expression', 'formula', 'text']), 'formulas', MAX.formulas, 'formulasAdded', false);

  // 6) procedures
  attach(asRecords(ext.procedures, ref, ['procedure', 'name', 'text']), 'procedures', MAX.procedures, 'proceduresAdded', false);

  // 7) relationships
  for (const rel of isArr(ext.relationships) ? ext.relationships.slice(0, 12) : []) {
    if (!isObj(rel)) continue;
    const fromName = isStr(rel.from) ? rel.from : (pageTopics[0] || '');
    const toName = isStr(rel.to) ? rel.to : (isStr(rel.target) ? rel.target : '');
    if (!fromName || !toName) continue;
    const fromHit = ensureTopic(kb, fromName, ref);
    const toHit = ensureTopic(kb, toName, ref);
    const relRec = {
      type: clipText(rel.type || 'related_to', 40),
      target_id: toHit.topic.id,
      target_name: toHit.topic.canonical_name,
      note: clipText(rel.note || '', 300),
      source_ref: ref
    };
    const dup = fromHit.topic.relationships.some(
      (r) => r.target_name === relRec.target_name && r.type === relRec.type
    );
    if (!dup) {
      fromHit.topic.relationships.push(relRec);
      if (fromHit.topic.relationships.length > MAX.relationships) fromHit.topic.relationships.shift();
      stats.relationshipsAdded++;
      if (fromHit.created) stats.topicsCreated++;
      if (toHit.created) stats.topicsCreated++;
    }
  }

  // 8) terminology -> flat glossary + topic.terminology
  for (const term of isArr(ext.terminology) ? ext.terminology.slice(0, 20) : []) {
    let termName = '';
    let meaning = '';
    if (isStr(term)) termName = term.trim();
    else if (isObj(term)) {
      termName = isStr(term.term) ? term.term.trim() : '';
      meaning = isStr(term.definition) ? term.definition : (isStr(term.meaning) ? term.meaning : '');
    }
    if (!termName) continue;
    const key = termName.slice(0, 60);
    if (!kb.glossary[key]) {
      kb.glossary[key] = clipText(meaning, 400);
      stats.glossaryAdded++;
    } else if (meaning && kb.glossary[key].length < 10 && meaning.length > kb.glossary[key].length) {
      kb.glossary[key] = clipText(meaning, 400);
    }
    const host = pageTopicObjs[0];
    if (host) {
      pushUnique(host.terminology, [{ term: key, meaning: clipText(meaning, 400), source_ref: ref }], MAX.terminology);
    }
  }

  // 9) contradictions -> conflict records (never silently resolved, §14)
  for (const con of isArr(ext.contradictions) ? ext.contradictions.slice(0, 8) : []) {
    let claims = [];
    if (isObj(con) && isArr(con.claims)) {
      claims = con.claims.map((c) => ({
        claim: clipText(isObj(c) ? (c.claim || c.text || '') : String(c), 500),
        document_id: meta.document_id,
        page: Number(meta.page) || 0
      })).filter((c) => c.claim);
    } else if (con) {
      const claimText = clipText(isObj(con) ? (con.description || con.claim || con.text || '') : String(con), 500);
      if (claimText) claims = [{ claim: claimText, document_id: meta.document_id, page: Number(meta.page) || 0 }];
    }
    if (claims.length < 2) continue; // a conflict needs at least two sides to be useful
    const topicName = isObj(con) && isStr(con.topic) ? con.topic : (pageTopics[0] || 'General');
    const host = ensureTopic(kb, topicName, ref);
    const conflict = {
      id: newId('conflict'),
      topic_id: host.topic.id,
      topic_name: host.topic.canonical_name,
      claims,
      status: 'unresolved'
    };
    const dupConflict = kb.conflicts.some((c) =>
      c.topic_id === conflict.topic_id &&
      JSON.stringify(c.claims.map((x) => x.claim.toLowerCase())) === JSON.stringify(conflict.claims.map((x) => x.claim.toLowerCase()))
    );
    if (!dupConflict) {
      kb.conflicts.push(conflict);
      stats.conflictsAdded++;
      if (kb.conflicts.length > MAX.conflicts) kb.conflicts.shift();
    }
  }

  // 10) unresolved references
  for (const ur of [].concat(isArr(ext.unresolved_references) ? ext.unresolved_references : [], isArr(ext.future_references) ? ext.future_references.filter((f) => isStr(f)) : []).slice(0, 8)) {
    const text = clipText(isObj(ur) ? (ur.text || ur.reference || '') : ur, 240);
    if (!text) continue;
    const key = text.toLowerCase();
    if (kb.unresolved_refs.some((u) => u.text.toLowerCase() === key)) continue;
    kb.unresolved_refs.push({ id: newId('ref'), text, document_id: meta.document_id, page: Number(meta.page) || 0 });
    stats.unresolvedAdded++;
    if (kb.unresolved_refs.length > MAX.unresolved) kb.unresolved_refs.shift();
  }

  // 11) duplicate candidates flagged by the extractor -> merge when confident
  for (const dc of isArr(ext.duplicate_candidates) ? ext.duplicate_candidates.slice(0, 5) : []) {
    if (!isObj(dc)) continue;
    const a = semanticResolver.exactMatch(kb, dc.a || dc.first || '');
    const b = semanticResolver.exactMatch(kb, dc.b || dc.second || '');
    if (a && b && a.topic.id !== b.topic.id) {
      mergeTopics(kb, a.topic.id, b.topic.id);
      stats.merged++;
    }
  }

  // fallback: page had topics but KB was empty and nothing attached yet
  if (!kb.topics.length && !pageTopics.length) {
    const seedText = clipText(ext.page_summary || '', 400) || strArray(ext.key_facts, 3).join(' ');
    if (seedText) {
      const kw = topKeywords([seedText], 3).join(' ');
      if (kw) {
        const { topic, created } = ensureTopic(kb, kw, ref);
        if (created) stats.topicsCreated++;
        pushUnique(topic.facts, asRecords(ext.key_facts, ref, ['fact', 'text']), 4);
        topic.summary = clipText(seedText, 700);
      }
    }
  }

  return { stats };
}

/** Merge secondary into primary; union everything, keep earliest first_seen. */
function mergeTopics(kb, primaryId, secondaryId) {
  const pi = kb.topics.findIndex((t) => t.id === primaryId);
  const si = kb.topics.findIndex((t) => t.id === secondaryId);
  if (pi === -1 || si === -1 || pi === si) return null;
  const primary = kb.topics[pi];
  const secondary = kb.topics[si];

  for (const alias of secondary.aliases.concat([secondary.canonical_name])) {
    const norm = semanticResolver.normalizeName(alias);
    const clash = normalizeNameIn(primary, norm);
    if (!clash && primary.aliases.length < MAX.aliases) primary.aliases.push(alias.trim().slice(0, 140));
  }
  const union = (field, cap) => {
    pushUnique(primary[field], secondary[field], cap);
  };
  union('definitions', MAX.definitions);
  union('facts', MAX.facts);
  union('examples', MAX.examples);
  union('formulas', MAX.formulas);
  union('procedures', MAX.procedures);
  union('terminology', MAX.terminology);
  union('entities', 40);
  for (const rel of secondary.relationships) {
    const dup = primary.relationships.some(
      (r) => r.target_name === rel.target_name && r.type === rel.type
    );
    if (!dup) primary.relationships.push(rel);
  }
  for (const ref of secondary.source_refs || []) {
    if (!primary.source_refs.some((r) => sameRef(r, ref))) primary.source_refs.push(ref);
  }
  if (!primary.summary && secondary.summary) primary.summary = secondary.summary;
  primary.last_updated = latestRef(primary.last_updated, secondary.last_updated);
  primary.source_refs.sort(byRefOrder);

  // remap conflicts and drop secondary
  for (const c of kb.conflicts) {
    if (c.topic_id === secondary.id) c.topic_id = primary.id;
  }
  for (const rel of primary.relationships) {
    if (rel.target_id === secondary.id) rel.target_id = primary.id;
  }
  kb.topics.splice(si, 1);
  return primary;
}

function normalizeNameIn(topic, normAlias) {
  return (
    semanticResolver.normalizeName(topic.canonical_name) === normAlias ||
    (topic.aliases || []).some((a) => semanticResolver.normalizeName(a) === normAlias)
  );
}

function byRefOrder(a, b) {
  return a.document_id === b.document_id
    ? (Number(a.page) || 0) - (Number(b.page) || 0)
    : String(a.document_id).localeCompare(String(b.document_id));
}

function latestRef(a, b) {
  if (!a) return b;
  if (!b) return a;
  return byRefOrder(a, b) >= 0 ? a : b;
}

function addAlias(kb, topicId, alias) {
  const topic = kb.topics.find((t) => t.id === topicId);
  if (!topic || !isStr(alias)) return false;
  const clean = alias.trim().slice(0, 140);
  if (!clean) return false;
  const norm = semanticResolver.normalizeName(clean);
  if (normalizeNameIn(topic, norm)) return false;
  // an alias must not collide with another topic's identity
  const other = kb.topics.find((t) => t.id !== topicId && normalizeNameIn(t, norm));
  if (other) return false;
  topic.aliases.push(clean);
  return true;
}

function renameTopic(kb, topicId, newName) {
  const topic = kb.topics.find((t) => t.id === topicId);
  if (!topic || !isStr(newName)) return false;
  const old = topic.canonical_name;
  topic.canonical_name = newName.trim().slice(0, 140);
  if (semanticResolver.normalizeName(old) !== semanticResolver.normalizeName(newName) && !topic.aliases.includes(old)) {
    topic.aliases.unshift(old);
    if (topic.aliases.length > MAX.aliases) topic.aliases.pop();
  }
  return true;
}

function excludeTopic(kb, topicId, excluded) {
  const topic = kb.topics.find((t) => t.id === topicId);
  if (!topic) return false;
  topic.excluded = Boolean(excluded);
  return true;
}

function resolveConflict(kb, conflictId, chosenClaimIndex, editedClaim) {
  const conflict = kb.conflicts.find((c) => c.id === conflictId);
  if (!conflict) return false;
  if (isStr(editedClaim)) {
    conflict.claims[chosenClaimIndex || 0] = {
      ...conflict.claims[chosenClaimIndex || 0],
      claim: clipText(editedClaim, 500)
    };
  }
  conflict.status = 'resolved';
  return true;
}

/** Compact planner input: active topics with hierarchy hints (§16, §17). */
function kbDigest(kb, opts) {
  const maxTopics = (opts && opts.maxTopics) || 90;
  const active = kb.topics.filter((t) => !t.excluded);
  return active.slice(0, maxTopics).map((t) => ({
    id: t.id,
    name: t.canonical_name,
    aliases: (t.aliases || []).slice(0, 4),
    summary: (t.summary || '').slice(0, 220),
    counts: {
      definitions: (t.definitions || []).length,
      facts: (t.facts || []).length,
      examples: (t.examples || []).length,
      formulas: (t.formulas || []).length,
      procedures: (t.procedures || []).length
    },
    related: (t.relationships || []).map((r) => r.target_name).filter(Boolean).slice(0, 8),
    sources: (t.source_refs || []).length
  }));
}

/** Retrieved slice for the writer: full-ish topics trimmed to budget (§28). */
function retrieveSlice(kb, topicIds, opts) {
  const caps = Object.assign({ charsPerTopic: 1500 }, opts || {});
  const wanted = new Set(topicIds || []);
  const slice = [];
  let budget = (opts && opts.totalChars) || 12000;
  for (const t of kb.topics) {
    if (t.excluded) continue;
    if (wanted.size && !wanted.has(t.id)) continue;
    const entry = {
      id: t.id,
      name: t.canonical_name,
      summary: t.summary || '',
      definitions: (t.definitions || []).slice(0, 6),
      facts: (t.facts || []).slice(0, 10),
      examples: (t.examples || []).slice(0, 3),
      formulas: (t.formulas || []).slice(0, 4),
      procedures: (t.procedures || []).slice(0, 2),
      relationships: (t.relationships || []).slice(0, 6),
      sources: (t.source_refs || []).slice(0, 8)
    };
    const size = JSON.stringify(entry).length;
    if (size > caps.charsPerTopic) {
      entry.facts = entry.facts.slice(0, 4);
      entry.definitions = entry.definitions.slice(0, 3);
    }
    budget -= size;
    slice.push(entry);
    if (budget <= 0) break;
  }
  return slice;
}

function glossaryFrom(kb) {
  return Object.entries(kb.glossary || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([term, definition]) => ({ term, definition: definition || '' }));
}

function kbStats(kb) {
  const active = kb.topics.filter((t) => !t.excluded);
  return {
    topics: active.length,
    excluded: kb.topics.length - active.length,
    aliases: active.reduce((n, t) => n + (t.aliases || []).length, 0),
    definitions: active.reduce((n, t) => n + (t.definitions || []).length, 0),
    facts: active.reduce((n, t) => n + (t.facts || []).length, 0),
    examples: active.reduce((n, t) => n + (t.examples || []).length, 0),
    formulas: active.reduce((n, t) => n + (t.formulas || []).length, 0),
    procedures: active.reduce((n, t) => n + (t.procedures || []).length, 0),
    conflictsOpen: kb.conflicts.filter((c) => c.status === 'unresolved').length,
    unresolvedRefs: kb.unresolved_refs.length,
    documents: (kb.documents || []).length
  };
}

/** Repair any untrusted object into a valid KB shape. */
function sanitizeKb(input) {
  const kb = createKb();
  if (!isObj(input)) return kb;
  if (isArr(input.topics)) {
    for (const t of input.topics.slice(0, MAX.topics)) {
      if (!isObj(t) || !isStr(t.canonical_name)) continue;
      const topic = blankTopic(clipText(t.canonical_name, 140), makeRef(t.first_seen && t.first_seen.document_id, t.first_seen && t.first_seen.page));
      topic.id = isStr(t.id) ? t.id : topic.id;
      topic.summary = clipText(t.summary, 1200);
      topic.aliases = strArray(t.aliases, MAX.aliases);
      topic.entities = strArray(t.entities, 40);
      topic.confidence = typeof t.confidence === 'number' ? t.confidence : 0.8;
      topic.excluded = Boolean(t.excluded);
      for (const field of ['definitions', 'facts', 'examples', 'formulas', 'procedures']) {
        topic[field] = (isArr(t[field]) ? t[field] : [])
          .filter((x) => x && (isStr(x.text) || isStr(x.expression)))
          .map((x) => ({
            ...x,
            text: clipText(x.text || x.expression || ''),
            source_ref: isObj(x.source_ref) ? x.source_ref : undefined
          }))
          .slice(0, MAX[field] || 40);
      }
      topic.relationships = (isArr(t.relationships) ? t.relationships : [])
        .filter((r) => isObj(r) && (isStr(r.target_name) || isStr(r.target_id)))
        .slice(0, MAX.relationships);
      topic.terminology = (isArr(t.terminology) ? t.terminology : [])
        .filter((x) => isObj(x) && isStr(x.term))
        .slice(0, MAX.terminology);
      topic.source_refs = (isArr(t.source_refs) ? t.source_refs : [])
        .filter((r) => isObj(r) && (isStr(r.document_id) || 'page' in r))
        .slice(0, 60);
      topic.first_seen = isObj(t.first_seen) ? t.first_seen : topic.first_seen;
      topic.last_updated = isObj(t.last_updated) ? t.last_updated : topic.first_seen;
      if (isStr(t.canonical_name)) kb.topics.push(topic);
    }
  }
  if (isArr(input.conflicts)) {
    kb.conflicts = input.conflicts
      .filter((c) => isObj(c) && isArr(c.claims))
      .slice(0, MAX.conflicts)
      .map((c) => ({
        id: isStr(c.id) ? c.id : newId('conflict'),
        topic_id: isStr(c.topic_id) ? c.topic_id : '',
        topic_name: clipText(c.topic_name, 140),
        claims: c.claims.filter((x) => isObj(x) && isStr(x.claim)).slice(0, 8),
        status: c.status === 'resolved' ? 'resolved' : 'unresolved'
      }));
  }
  if (isArr(input.unresolved_refs)) {
    kb.unresolved_refs = input.unresolved_refs
      .filter((u) => isObj(u) && isStr(u.text))
      .slice(0, MAX.unresolved)
      .map((u) => ({
        id: isStr(u.id) ? u.id : newId('ref'),
        text: clipText(u.text, 240),
        document_id: isStr(u.document_id) ? u.document_id : 'doc',
        page: Number(u.page) || 0
      }));
  }
  if (isObj(input.glossary)) {
    for (const [k, v] of Object.entries(input.glossary).slice(0, 400)) {
      if (isStr(k)) kb.glossary[k.slice(0, 60)] = clipText(v, 400);
    }
  }
  if (isArr(input.documents)) kb.documents = input.documents.filter(isObj).slice(0, 60);
  return kb;
}

module.exports = {
  createKb,
  sanitizeKb,
  applyExtraction,
  mergeTopics,
  addAlias,
  renameTopic,
  excludeTopic,
  resolveConflict,
  resolveReferenceTopic: (kb, name) => semanticResolver.resolveTopic(kb, name, name),
  kbDigest,
  retrieveSlice,
  glossaryFrom,
  kbStats,
  makeRef,
  newId,
  MAX
};
