/**
 * KnowledgeExtractor — one page -> spec §8 extraction JSON.
 * AI path enforces the exact spec schema via constrained retry; keyless path
 * falls back to a deterministic heuristic pass.
 */
const aiProvider = require('./aiProvider');
const { parseJsonLoose, isStr, isArr, isObj, strArray } = require('./jsonUtils');

const EXTRACT_SYSTEM =
  'You are an elite academic knowledge extraction system. Convert the provided text into rigorous, structured notes.\n\n' +
  'EXTRACTION PHILOSOPHY:\n' +
  '- DEPTH over breadth: Capture nuanced arguments, not just surface facts\n' +
  '- PRECISION: Preserve original terminology, formulas, and quantitative data\n' +
  '- STRUCTURE: Organize hierarchically (topic, subtopic, key points, evidence)\n' +
  '- CONNECTIONS: Explicitly map relationships between concepts\n' +
  '- CRITICAL LENS: Identify assumptions, limitations, and open questions\n\n' +
  'CONTEXT AWARENESS — CRITICAL:\n' +
  'You have already covered these topics in previous pages: [DYNAMIC_LIST].\n' +
  '- If a topic reappears, ONLY add NEW information, deeper insights, or different perspectives.\n' +
  '- NEVER duplicate content from previous pages.\n' +
  '- Maintain narrative continuity — reference how this page connects to previous discussions.\n' +
  '- Flag contradictions or updates to previously stated information.\n\n' +
  'Reply with STRICT JSON only, shaped exactly:\n' +
  '{\n' +
  '  "pageNum": <number>,\n' +
  '  "mainTopic": "The central theme (5-8 words)",\n' +
  '  "topics": ["topic1", "topic2", "topic3"],\n' +
  '  "summary": "2-3 sentences capturing the essence and significance",\n' +
  '  "keyPoints": [\n' +
  '    {\n' +
  '      "point": "Specific, substantive insight (not generic)",\n' +
  '      "category": "definition|concept|example|formula|insight|quote",\n' +
  '      "importance": "high|medium|low",\n' +
  '      "relatedTo": ["connected topic names"]\n' +
  '    }\n' +
  '  ],\n' +
  '  "definitions": [\n' +
  '    {"term": "Precise term", "definition": "Exact definition from text"}\n' +
  '  ],\n' +
  '  "relationships": [\n' +
  '    {"from": "Concept A", "to": "Concept B", "type": "causes|enables|contradicts|extends|example_of|prerequisite_of"}\n' +
  '  ],\n' +
  '  "openQuestions": ["Genuine gaps or questions raised"],\n' +
  '  "continuityNote": "How this connects to prior context",\n' +
  '  "newInsights": ["Novel contributions not seen before"],\n' +
  '  "confidence": "high|medium|low"\n' +
  '}\n\n' +
  'QUALITY CRITERIA:\n' +
  '- Each key point must be specific enough to be useful for study/review\n' +
  '- Include page-specific examples, numbers, and direct quotes when present\n' +
  '- Flag uncertain information with low confidence\n' +
  '- Identify logical structure (premise, argument, conclusion)\n' +
  '- Note methodological approaches if academic text\n' +
  '- mainTopic should be a single concise phrase (5-8 words)\n' +
  '- topics should list every distinct concept this page teaches or uses substantially\n' +
  '- keyPoints.category must be exactly one of: definition, concept, example, formula, insight, quote\n' +
  '- keyPoints.importance must be exactly one of: high, medium, low\n' +
  '- relationships.type must be exactly one of: causes, enables, contradicts, extends, example_of, prerequisite_of\n' +
  '- Leave arrays empty when nothing qualifies — never pad';

/** Shape arbitrary parsed JSON into the spec extraction contract. */
function normalizeExtraction(raw) {
  const VALID_CATEGORIES = new Set(['definition', 'concept', 'example', 'formula', 'insight', 'quote']);
  const VALID_IMPORTANCE = new Set(['high', 'medium', 'low']);
  const VALID_REL_TYPES = new Set(['causes', 'enables', 'contradicts', 'extends', 'example_of', 'prerequisite_of']);
  const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

  const out = {
    pageNum: null,
    mainTopic: '',
    topics: [],
    summary: '',
    keyPoints: [],
    definitions: [],
    relationships: [],
    openQuestions: [],
    continuityNote: '',
    newInsights: [],
    confidence: 'medium',
    // backward-compat fields for the KB ingestion pipeline
    page_summary: '',
    new_information: [],
    key_facts: [],
    examples: [],
    formulas: [],
    procedures: [],
    terminology: [],
    contradictions: [],
    unresolved_references: [],
    future_references: [],
    duplicate_candidates: []
  };
  if (!isObj(raw)) return out;

  // Spec fields
  if (typeof raw.pageNum === 'number') out.pageNum = raw.pageNum;
  if (isStr(raw.mainTopic)) out.mainTopic = raw.mainTopic.trim().slice(0, 120);
  out.topics = strArray(raw.topics, 10);
  if (isStr(raw.summary)) out.summary = raw.summary.trim().slice(0, 900);
  if (isStr(raw.continuityNote)) out.continuityNote = raw.continuityNote.trim().slice(0, 500);
  if (VALID_CONFIDENCE.has(raw.confidence)) out.confidence = raw.confidence;

  if (isArr(raw.keyPoints)) {
    for (const kp of raw.keyPoints.slice(0, 20)) {
      if (!isObj(kp)) continue;
      const point = isStr(kp.point) ? kp.point.trim() : '';
      if (!point) continue;
      const cat = isStr(kp.category) && VALID_CATEGORIES.has(kp.category) ? kp.category : 'insight';
      const imp = isStr(kp.importance) && VALID_IMPORTANCE.has(kp.importance) ? kp.importance : 'medium';
      const rel = isArr(kp.relatedTo) ? kp.relatedTo.filter(isStr).map((s) => s.trim().slice(0, 80)).slice(0, 6) : [];
      out.keyPoints.push({ point: point.slice(0, 800), category: cat, importance: imp, relatedTo: rel });
    }
  }

  if (isArr(raw.definitions)) {
    for (const d of raw.definitions.slice(0, 15)) {
      if (!isObj(d)) continue;
      const term = isStr(d.term) ? d.term.trim() : '';
      const def = isStr(d.definition) ? d.definition.trim() : '';
      if (!term && !def) continue;
      out.definitions.push({ term: term.slice(0, 120), definition: def.slice(0, 600) });
    }
  }

  if (isArr(raw.relationships)) {
    for (const r of raw.relationships.slice(0, 15)) {
      if (!isObj(r)) continue;
      const from = isStr(r.from) ? r.from.trim() : '';
      const to = isStr(r.to) ? r.to.trim() : '';
      if (!from || !to) continue;
      const type = isStr(r.type) && VALID_REL_TYPES.has(r.type) ? r.type : 'extends';
      out.relationships.push({ from: from.slice(0, 80), to: to.slice(0, 80), type });
    }
  }

  out.openQuestions = strArray(raw.openQuestions, 8).map((s) => s.slice(0, 300));
  out.newInsights = strArray(raw.newInsights, 10).map((s) => s.slice(0, 300));

  // Backward-compat: map spec fields to legacy KB fields
  if (out.mainTopic && !out.topics.includes(out.mainTopic)) {
    out.topics.unshift(out.mainTopic);
  }
  out.page_summary = out.summary;

  for (const kp of out.keyPoints) {
    const topicName = (kp.relatedTo && kp.relatedTo[0]) || (out.topics[0] || '');
    if (kp.category === 'definition') {
      const parts = kp.point.split(/[:–—]\s*/);
      if (parts.length >= 2) {
        const term = parts[0].trim();
        const existing = out.definitions.find((d) => d.term.toLowerCase() === term.toLowerCase().slice(0, 60));
        if (!existing) {
          out.definitions.push({ term: term.slice(0, 120), definition: parts.slice(1).join(': ').trim().slice(0, 600) });
        }
      } else {
        out.new_information.push({ topic: topicName, text: kp.point });
      }
    } else if (kp.category === 'formula') {
      out.formulas.push({ topic: topicName, expression: kp.point });
    } else if (kp.category === 'example') {
      out.examples.push({ topic: topicName, title: kp.point.slice(0, 100), text: kp.point });
    } else {
      out.new_information.push({ topic: topicName, text: kp.point });
    }
  }

  out.unresolved_references = out.openQuestions.map((q) => q.slice(0, 240));

  return out;
}

/**
 * Deterministic offline extraction: sentences become facts, "X is a Y"
 * sentences become definitions, equals-sign lines become formulas.
 */
function heuristicExtraction(pageText) {
  const ext = {
    pageNum: null, mainTopic: '', topics: [], summary: '', keyPoints: [],
    definitions: [], relationships: [], openQuestions: [], continuityNote: '',
    newInsights: [], confidence: 'low',
    page_summary: '', new_information: [], key_facts: [], examples: [],
    formulas: [], procedures: [], terminology: [], contradictions: [],
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
      const term = m[1].trim();
      const def = `${term} is ${m[2]} ${m[3].trim()}.`;
      ext.definitions.push({ term, definition: def });
      ext.keyPoints.push({ point: `${term}: ${def}`, category: 'definition', importance: 'medium', relatedTo: [] });
      if (!ext.topics.includes(term)) ext.topics.push(term);
    }
  }

  // facts: informative-looking sentences
  const facts = trimmed
    .filter((s) => /\d|[a-z]{3,}\s+[a-z]{3,}/.test(s))
    .slice(0, 8)
    .map((s) => (s.endsWith('.') ? s : s + '.'));
  ext.key_facts = facts;
  for (const f of facts) {
    ext.keyPoints.push({ point: f, category: 'insight', importance: 'medium', relatedTo: [] });
  }

  // formulas / expressions: capture "<lhs> = <rhs>" inside prose lines
  for (const line of String(pageText || '').split('\n')) {
    const l = line.trim();
    if (!l.includes('=')) continue;
    const m = l.match(/([A-Za-z0-9_^)\]]+(?:[\s*+/-]*[A-Za-z0-9_^)\]]+){0,6})\s*=\s*([^=;]{2,120})/);
    if (m) {
      const lhs = m[1].trim();
      const rhs = m[2].trim();
      if (/[A-Za-z0-9]/.test(lhs) && /[A-Za-z0-9]/.test(rhs)) {
        const expr = `${lhs} = ${rhs}`.slice(0, 300);
        ext.formulas.push({ expression: expr });
        ext.keyPoints.push({ point: expr, category: 'formula', importance: 'high', relatedTo: [] });
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

  ext.mainTopic = ext.topics[0] || 'Untitled page';
  if (trimmed.length) ext.summary = trimmed.slice(0, 2).join(' ').slice(0, 700);
  ext.page_summary = ext.summary;
  ext.confidence = trimmed.length > 3 ? 'medium' : 'low';

  // open questions from interrogative sentences
  for (const s of trimmed) {
    if (/\?$/.test(s) && /^(?:what|how|why|when|where|which|who|can|does|is|are|do|should)/i.test(s)) {
      ext.openQuestions.push(s);
      ext.unresolved_references.push(s);
      if (ext.openQuestions.length >= 4) break;
    }
  }

  return ext;
}

async function extractFromPage({ pageText, docContext, recentTopics, slidingWindow }, aiConfig) {
  if (!aiProvider.available(aiConfig)) {
    return { extraction: heuristicExtraction(pageText), mode: 'heuristic' };
  }

  const contextParts = [];
  if (docContext) contextParts.push(`DOCUMENT CONTEXT (title/subject): ${String(docContext).slice(0, 600)}`);
  if (recentTopics && recentTopics.length) {
    contextParts.push('ALREADY COVERED TOPICS (DO NOT DUPLICATE):\n' + recentTopics.slice(0, 30).map((t) => `  - ${t}`).join('\n'));
  }
  if (slidingWindow) {
    const windowParts = [];
    if (slidingWindow.recentSummaries && slidingWindow.recentSummaries.length) {
      windowParts.push('SUMMARY OF RECENT PAGES:\n' + slidingWindow.recentSummaries.map((s, i) => `  [Page ${slidingWindow.startPage + i}]: ${s}`).join('\n'));
    }
    if (slidingWindow.openQuestions && slidingWindow.openQuestions.length) {
      windowParts.push('OPEN QUESTIONS FROM EARLIER:\n' + slidingWindow.openQuestions.map((q) => `  - ${q}`).join('\n'));
    }
    if (windowParts.length) {
      contextParts.push('SLIDING CONTEXT WINDOW:\n' + windowParts.join('\n'));
    }
  }
  contextParts.push('RULES:\n- If a listed topic reappears, ONLY add NEW information, deeper analysis, or contrasting viewpoints.\n- NEVER repeat definitions, examples, or explanations already given.\n- Maintain narrative flow — show how this page connects to previous discussions.\n- Note if this page answers a previously open question.');

  const contextBlock = contextParts.join('\n\n');

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const retryNote = attempt === 1 ? '\n\nYour previous reply was not valid JSON matching the schema. Return ONLY the JSON object.' : '';
      const raw = await aiProvider.complete(
        EXTRACT_SYSTEM,
        `${contextBlock}\n\nPAGE TEXT:\n${String(pageText || '').slice(0, 24000)}${retryNote}`,
        { maxTokens: 2400, temperature: 0.2, timeoutMs: 35000 },
        aiConfig
      );
      const normalized = normalizeExtraction(parseJsonLoose(raw));
      if (normalized.topics.length || normalized.keyPoints.length || normalized.definitions.length || normalized.key_facts.length) {
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
