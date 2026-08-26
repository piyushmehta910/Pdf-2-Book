/**
 * KnowledgeExtractor — one page -> strict §8 extraction JSON.
 * AI path enforces schema via constrained retry; keyless path falls back to a
 * deterministic heuristic pass so the pipeline still produces KB content.
 */
const aiProvider = require('./aiProvider');
const { parseJsonLoose, isStr, isArr, isObj, strArray } = require('./jsonUtils');

const EXTRACT_SYSTEM =
  'You extract structured knowledge from one page of an academic/technical PDF for a canonical knowledge base. Extract ONLY information explicitly present on the page. Never invent content. Use the page\'s own terminology. Topic names should be short canonical concept names (1-4 words).\n\n' +
  'Reply with STRICT JSON only, shaped exactly:\n' +
  '{"topics":[string],\n' +
  '"page_summary":string,\n' +
  '"definitions":[{"topic":string,"term":string,"definition":string}],\n' +
  '"new_information":[{"topic":string,"text":string}],\n' +
  '"key_facts":[string],\n' +
  '"examples":[{"topic":string,"title":string,"text":string}],\n' +
  '"formulas":[{"topic":string,"expression":string}],\n' +
  '"procedures":[{"topic":string,"name":string,"steps":[string]}],\n' +
  '"relationships":[{"from":string,"to":string,"type":"prerequisite|related|contrasts","note":string}],\n' +
  '"terminology":[{"term":string,"definition":string}],\n' +
  '"contradictions":[{"topic":string,"claims":[string]}],\n' +
  '"unresolved_references":[string],\n' +
  '"future_references":[string],\n' +
  '"duplicate_candidates":[{"a":string,"b":string}]}\n\n' +
  'Rules: topics lists every distinct concept this page teaches or uses substantially. new_information items each carry the "topic" they belong to. procedures use "steps" as an ordered string array. Leave arrays empty when nothing qualifies — never pad.';

/** Shape arbitrary parsed JSON into the exact extraction contract. */
function normalizeExtraction(raw) {
  const out = {
    topics: [],
    page_summary: '',
    definitions: [],
    new_information: [],
    key_facts: [],
    examples: [],
    formulas: [],
    procedures: [],
    relationships: [],
    terminology: [],
    contradictions: [],
    unresolved_references: [],
    future_references: [],
    duplicate_candidates: []
  };
  if (!isObj(raw)) return out;
  out.topics = strArray(raw.topics, 10);
  if (isStr(raw.page_summary)) out.page_summary = raw.page_summary.trim().slice(0, 900);

  const pickText = (v, keys) => {
    if (isStr(v)) return v.trim();
    if (isObj(v)) {
      for (const k of keys) if (isStr(v[k]) && v[k].trim()) return v[k].trim();
    }
    return '';
  };
  const topicOf = (v) => (isObj(v) && isStr(v.topic) ? v.topic.trim().slice(0, 80) : '');

  for (const d of isArr(raw.definitions) ? raw.definitions.slice(0, 12) : []) {
    const text = pickText(d, ['definition', 'meaning', 'text']);
    if (!text) continue;
    out.definitions.push({
      topic: topicOf(d),
      term: isObj(d) && isStr(d.term) ? d.term.trim().slice(0, 120) : '',
      definition: text
    });
  }

  const infoSources = [].concat(isArr(raw.new_information) ? raw.new_information : [], isArr(raw.key_facts) ? raw.key_facts : []);
  for (const f of infoSources.slice(0, 24)) {
    const text = pickText(f, ['text', 'fact', 'claim', 'information']);
    if (!text) continue;
    if (isStr(f)) { out.key_facts.push(f.trim().slice(0, 400)); continue; }
    const rec = { text: text.slice(0, 500) };
    const t = topicOf(f);
    if (t) rec.topic = t;
    out.new_information.push(rec);
  }

  for (const e of isArr(raw.examples) ? raw.examples.slice(0, 8) : []) {
    const text = pickText(e, ['text', 'content']);
    if (!text) continue;
    out.examples.push({ topic: topicOf(e), title: isObj(e) && isStr(e.title) ? e.title.trim().slice(0, 140) : '', text: text.slice(0, 1500) });
  }

  for (const f of isArr(raw.formulas) ? raw.formulas.slice(0, 10) : []) {
    const expr = pickText(f, ['expression', 'formula', 'text']);
    if (!expr) continue;
    out.formulas.push({ topic: topicOf(f), expression: expr.slice(0, 300) });
  }

  for (const p of isArr(raw.procedures) ? raw.procedures.slice(0, 6) : []) {
    const steps = strArray(isObj(p) ? p.steps : null, 15).map((s) => s.slice(0, 300));
    const name = isObj(p) && isStr(p.name) ? p.name.trim().slice(0, 160) : '';
    if (!steps.length && !name) continue;
    out.procedures.push({
      topic: topicOf(p),
      name,
      steps,
      // flat text form so the KB can store procedures as single records
      text: steps.map((s, i) => `${i + 1}. ${s}`).join(' | ')
    });
  }

  for (const r of isArr(raw.relationships) ? raw.relationships.slice(0, 12) : []) {
    if (!isObj(r)) continue;
    const from = isStr(r.from) ? r.from.trim() : '';
    const to = isStr(r.to) ? r.to.trim() : '';
    if (!from || !to) continue;
    out.relationships.push({
      from: from.slice(0, 80),
      to: to.slice(0, 80),
      type: isStr(r.type) ? r.type : 'related',
      note: isStr(r.note) ? r.note.slice(0, 300) : ''
    });
  }

  for (const t of isArr(raw.terminology) ? raw.terminology.slice(0, 20) : []) {
    const term = pickText(t, ['term', 'name']);
    if (!term) continue;
    out.terminology.push({ term: term.slice(0, 60), definition: pickText(t, ['definition', 'meaning']).slice(0, 400) });
  }

  for (const c of isArr(raw.contradictions) ? raw.contradictions.slice(0, 6) : []) {
    if (!isObj(c)) continue;
    const claims = strArray(c.claims, 4).map((s) => s.slice(0, 500));
    if (claims.length < 2) continue;
    out.contradictions.push({ topic: isStr(c.topic) ? c.topic : '', claims });
  }

  out.unresolved_references = strArray(raw.unresolved_references, 6).map((s) => s.slice(0, 240));
  out.future_references = strArray(raw.future_references, 6).map((s) => s.slice(0, 240));

  for (const dc of isArr(raw.duplicate_candidates) ? raw.duplicate_candidates.slice(0, 5) : []) {
    if (!isObj(dc)) continue;
    const a = isStr(dc.a) ? dc.a.trim() : '';
    const b = isStr(dc.b) ? dc.b.trim() : '';
    if (a && b) out.duplicate_candidates.push({ a: a.slice(0, 80), b: b.slice(0, 80) });
  }

  return out;
}

/**
 * Deterministic offline extraction: sentences become facts, "X is a Y"
 * sentences become definitions, equals-sign lines become formulas.
 */
function heuristicExtraction(pageText) {
  const ext = {
    topics: [], page_summary: '', definitions: [], new_information: [],
    key_facts: [], examples: [], formulas: [], procedures: [],
    relationships: [], terminology: [], contradictions: [],
    unresolved_references: [], future_references: [], duplicate_candidates: []
  };
  const sentences = String(pageText || '')
    .replace(/\n+/g, ' ')
    .match(/[^.!?]{20,320}[.!?]/g) || [];
  const trimmed = sentences.map((s) => s.trim()).filter(Boolean);

  // definitions: "<Term> is a/an/the ..."
  for (const s of trimmed) {
    const m = s.match(/^([A-Z][A-Za-z0-9 -]{2,50}?)\s+(?:is|are)\s+(a|an|the)\s+([^.!?]{10,240})[.!?]?$/);
    if (m) {
      ext.definitions.push({ topic: m[1].trim(), term: m[1].trim(), definition: `${m[1].trim()} is ${m[2]} ${m[3].trim()}.` });
      if (!ext.topics.includes(m[1].trim())) ext.topics.push(m[1].trim());
    }
  }

  // facts: informative-looking sentences
  ext.key_facts = trimmed
    .filter((s) => /\d|[a-z]{3,}\s+[a-z]{3,}/.test(s))
    .slice(0, 8)
    .map((s) => (s.endsWith('.') ? s : s + '.'));

  // formulas / expressions: capture "<lhs> = <rhs>" inside prose lines
  for (const line of String(pageText || '').split('\n')) {
    const l = line.trim();
    if (!l.includes('=')) continue;
    const m = l.match(/([A-Za-z0-9_^)\]]+(?:[\s*+/-]*[A-Za-z0-9_^)\]]+){0,6})\s*=\s*([^=;]{2,120})/);
    if (m) {
      const lhs = m[1].trim();
      const rhs = m[2].trim();
      if (/[A-Za-z0-9]/.test(lhs) && /[A-Za-z0-9]/.test(rhs)) {
        ext.formulas.push({ expression: `${lhs} = ${rhs}`.slice(0, 300) });
      }
    }
  }

  // topics: definition subjects first, then capitalized lead phrases
  if (!ext.topics.length) {
    const seen = new Set();
    for (const s of trimmed) {
      const m = s.match(/^(?:The\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        ext.topics.push(m[1]);
      }
      if (ext.topics.length >= 4) break;
    }
  }

  if (trimmed.length) ext.page_summary = trimmed.slice(0, 2).join(' ').slice(0, 700);
  return ext;
}

async function extractFromPage({ pageText, docContext, recentTopics }, aiConfig) {
  if (!aiProvider.available(aiConfig)) {
    return { extraction: heuristicExtraction(pageText), mode: 'heuristic' };
  }
  const contextBlock = [
    docContext ? `DOCUMENT CONTEXT (title/subject): ${String(docContext).slice(0, 600)}` : '',
    recentTopics && recentTopics.length ? `TOPICS EXTRACTED EARLIER IN THIS DOCUMENT (reuse these names when appropriate): ${recentTopics.slice(0, 25).join(', ')}` : ''
  ].filter(Boolean).join('\n');

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const retryNote = attempt === 1 ? '\n\nYour previous reply was not valid JSON matching the schema. Return ONLY the JSON object.' : '';
      const raw = await aiProvider.complete(
        EXTRACT_SYSTEM,
        `${contextBlock}\n\nPAGE TEXT:\n${String(pageText || '').slice(0, 24000)}${retryNote}`,
        { maxTokens: 2200, temperature: 0.2, timeoutMs: 35000 },
        aiConfig
      );
      const normalized = normalizeExtraction(parseJsonLoose(raw));
      if (normalized.topics.length || normalized.key_facts.length || normalized.definitions.length) {
        return { extraction: normalized, mode: 'ai' };
      }
      lastErr = new Error('empty extraction');
    } catch (err) {
      lastErr = err;
    }
  }
  return { extraction: heuristicExtraction(pageText), mode: 'heuristic', degraded: true, reason: lastErr ? lastErr.message : 'unusable AI output' };
}

module.exports = { extractFromPage, heuristicExtraction, normalizeExtraction, EXTRACT_SYSTEM };
