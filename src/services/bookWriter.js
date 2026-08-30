/**
 * BookWriter — converts a planned chapter + retrieved KB slice into validated
 * content_blocks JSON (master spec §19–20). Never invents facts; keyless mode
 * builds blocks deterministically straight from the KB.
 */
const aiProvider = require('./aiProvider');
const { getPreset } = require('./bookPresets');
const { parseJsonLoose, isStr, isArr, isObj } = require('./jsonUtils');

const WRITE_SYSTEM =
  'You are an expert educational author and technical editor. You receive ONE CHAPTER PLAN, the BOOK PRESET rules, a CANONICAL KNOWLEDGE SLICE (verified facts with sources), and RECENT CHAPTER SUMMARIES for continuity.\n' +
  'Convert this into finished book content. You must NOT invent factual information — every claim must come from the knowledge slice. When a concept was already explained in earlier summaries, prefer a brief reminder or cross-reference over repeating the definition. If two sources conflict, present both positions explicitly instead of blending them into false certainty.\n\n' +
  'Reply with STRICT JSON only: {"sections":[{"title":string,"blocks":[<block>]}],"openQuestions":[string],"continuityNote":string} where each block is one of:\n' +
  '{"type":"paragraph","text":string}\n' +
  '{"type":"definition","term":string,"definition":string}\n' +
  '{"type":"bullet_list","items":[string]}\n' +
  '{"type":"example","title":string,"content":string}\n' +
  '{"type":"formula","expression":string,"explanation":string}\n' +
  '{"type":"table","headers":[string],"rows":[[string]]}\n' +
  '{"type":"warning","text":string}\n' +
  '{"type":"note","text":string}\n' +
  '{"type":"quote","text":string,"author":string}\n' +
  '{"type":"exercise","title":string,"content":string,"answer":string}\n' +
  '{"type":"callout","type":"info|warning|tip|summary","title":string,"text":string}\n' +
  '{"type":"relationship_map","relationships":[{"from":string,"to":string,"type":string,"label":string}]}\n' +
  '{"type":"importance","level":"high|medium|low","text":string}\n' +
  'Finish the last section with a "summary" block type if the preset requests summaries.\n' +
  'Include a "relationship_map" block if the chapter covers 3+ related concepts.\n' +
  'Use "importance" blocks to highlight key takeaways marked high/medium/low.\n' +
  'At the top-level JSON, include "openQuestions" (string array) and "continuityNote" (string) for cross-chapter coherence.';

const BLOCK_TYPES = new Set(['paragraph', 'definition', 'bullet_list', 'example', 'exercise', 'quote', 'callout', 'formula', 'table', 'warning', 'note', 'summary', 'relationship_map', 'importance', 'pageBreak']);

/** Validate + repair one AI-returned section list. Drops only unusable items. */
function sanitizeBlocks(rawSections) {
  const sections = [];
  for (const sec of isArr(rawSections) ? rawSections : []) {
    if (!isObj(sec) || !isStr(sec.title)) continue;
    const blocks = [];
    for (const b of isArr(sec.blocks) ? sec.blocks : []) {
      if (!isObj(b) || !BLOCK_TYPES.has(b.type)) continue;
      const out = { type: b.type };
      switch (b.type) {
        case 'paragraph': case 'warning': case 'note': case 'summary':
          if (!isStr(b.text)) continue;
          out.text = b.text.trim().slice(0, 6000);
          break;
        case 'callout':
          if (!isStr(b.text)) continue;
          out.text = b.text.trim().slice(0, 6000);
          out.title = isStr(b.title) ? b.title.trim().slice(0, 140) : '';
          out.style = isStr(b.style) ? b.style.trim().slice(0, 30) : 'info';
          break;
        case 'quote':
          if (!isStr(b.text)) continue;
          out.text = b.text.trim().slice(0, 2000);
          out.author = isStr(b.author) ? b.author.trim().slice(0, 120) : '';
          break;
        case 'definition':
          if (!isStr(b.term) || !isStr(b.definition)) continue;
          out.term = b.term.trim().slice(0, 140);
          out.definition = b.definition.trim().slice(0, 2000);
          break;
        case 'bullet_list': {
          const items = (isArr(b.items) ? b.items : []).filter(isStr).map((s) => s.trim().slice(0, 500));
          if (!items.length) continue;
          out.items = items.slice(0, 20);
          break;
        }
        case 'example':
          if (!isStr(b.content)) continue;
          out.title = isStr(b.title) ? b.title.trim().slice(0, 140) : '';
          out.content = b.content.trim().slice(0, 3000);
          break;
        case 'exercise':
          if (!isStr(b.content) && !isStr(b.question)) continue;
          out.title = isStr(b.title) ? b.title.trim().slice(0, 140) : '';
          out.content = (b.content || b.question || '').trim().slice(0, 2000);
          out.answer = isStr(b.answer) ? b.answer.trim().slice(0, 1000) : '';
          break;
        case 'formula':
          if (!isStr(b.expression)) continue;
          out.expression = b.expression.trim().slice(0, 300);
          out.explanation = isStr(b.explanation) ? b.explanation.trim().slice(0, 1000) : '';
          break;
        case 'table': {
          const headers = (isArr(b.headers) ? b.headers : []).filter(isStr).map((s) => s.trim().slice(0, 80));
          const rows = (isArr(b.rows) ? b.rows : [])
            .map((r) => (isArr(r) ? r.filter(isStr).map((s) => s.trim().slice(0, 160)) : []))
            .filter((r) => r.length)
            .slice(0, 30);
          if (!headers.length && !rows.length) continue;
          out.headers = headers;
          out.rows = rows;
          break;
        }
        case 'relationship_map': {
          const rels = (isArr(b.relationships) ? b.relationships : [])
            .filter((r) => isObj(r) && isStr(r.from) && isStr(r.to))
            .slice(0, 20)
            .map((r) => ({
              from: r.from.trim().slice(0, 80),
              to: r.to.trim().slice(0, 80),
              type: isStr(r.type) ? r.type.trim().slice(0, 40) : 'related',
              label: isStr(r.label) ? r.label.trim().slice(0, 80) : ''
            }));
          if (!rels.length) continue;
          out.relationships = rels;
          break;
        }
        case 'importance': {
          const level = ['high', 'medium', 'low'].includes(b.level) ? b.level : 'medium';
          if (!isStr(b.text)) continue;
          out.level = level;
          out.text = b.text.trim().slice(0, 500);
          break;
        }
        case 'pageBreak':
          out.manual = true;
          break;
      }
      if (b.sourceRef) out.sourceRef = b.sourceRef;
      blocks.push(out);
    }
    if (blocks.length) sections.push({ title: sec.title.trim().slice(0, 140), blocks });
  }
  return sections;
}

function refLabel(ref) {
  if (!ref) return '';
  return `[${ref.file_name || ref.document_id || 'source'}${ref.page ? ', p.' + ref.page : ''}]`;
}

/** Deterministic keyless writer — KB items become blocks directly. */
function deterministicSections(chapter, slice, preset) {
  const sections = [];
  let current = null;
  const push = () => { if (current && current.blocks.length) sections.push(current); };
  const startNew = (title) => { push(); current = { title: title || chapter.title, blocks: [] }; };
  startNew(chapter.title);

  for (const topic of slice) {
    if (topic.summary) current.blocks.push({ type: 'paragraph', text: topic.summary });
    for (const d of topic.definitions || []) {
      current.blocks.push({ type: 'definition', term: d.term || topic.name, definition: d.text, sourceRef: d.source_ref });
    }
    if ((topic.facts || []).length) {
      current.blocks.push({
        type: 'bullet_list',
        items: topic.facts.map((f) => f.text + (preset.include && preset.include.sources && f.source_ref ? ' ' + refLabel(f.source_ref) : ''))
      });
    }
    for (const f of topic.formulas || []) {
      current.blocks.push({ type: 'formula', expression: f.expression || f.text || '', explanation: '' });
    }
    for (const p of topic.procedures || []) {
      current.blocks.push({
        type: 'bullet_list',
        items: String(p.text).split(' | ').map((s) => s.replace(/^\d+[.)]\s*/, '')).filter(Boolean)
      });
    }
    for (const e of topic.examples || []) {
      current.blocks.push({ type: 'example', title: e.title || 'Example', content: e.text });
    }
    if (slice.indexOf(topic) < slice.length - 1) {
      const next = slice[slice.indexOf(topic) + 1];
      startNew(next.name);
    }
  }
  push();

  if (preset && preset.include && preset.include.summary && slice.length) {
    const last = sections[sections.length - 1] || current;
    if (last) {
      last.blocks.push({
        type: 'summary',
        text: `Key points: ${slice.map((t) => t.name).join(', ')} were covered in this chapter.`
      });
    }
  }

  return sections.length ? sections : [{ title: chapter.title, blocks: [{ type: 'paragraph', text: chapter.purpose || 'No content generated.' }] }];
}

async function writeChapter({ title, chapter, presetId, kbSlice, recentSummaries }, aiConfig) {
  const preset = getPreset(presetId);
  const slice = isArr(kbSlice) ? kbSlice : [];
  const recent = isArr(recentSummaries) ? recentSummaries.slice(-4) : [];

  if (!aiProvider.available(aiConfig)) {
    return {
      sections: deterministicSections(chapter, slice, preset),
      summary: `${chapter.title}: covered ${slice.map((t) => t.name).join(', ')}.`,
      mode: 'fallback'
    };
  }

  try {
    const userParts = [
      `BOOK: ${title || 'Untitled'}`,
      `PRESET RULES [${preset.label}]: tone ${preset.tone}; reading level ${preset.readingLevel}; ${preset.depthHint}; examples: ${preset.exampleDensity}; structure: ${preset.structure || 'standard chapters'}${preset.draftAddendum ? '; ' + preset.draftAddendum : ''}`,
      `CHAPTER: ${chapter.title}${chapter.purpose ? ' — ' + chapter.purpose : ''}`,
      `RECENT SUMMARIES (do not repeat these):\n${recent.map((s) => '- ' + s).join('\n') || '(none)'}`,
      `KNOWLEDGE SLICE:\n${JSON.stringify(slice)}`
    ];
    const raw = await aiProvider.complete(
      WRITE_SYSTEM,
      userParts.join('\n\n'),
      { maxTokens: 2800, temperature: 0.5, timeoutMs: 35000 },
      aiConfig
    );
    const parsed = parseJsonLoose(raw);
    const sections = sanitizeBlocks(parsed && parsed.sections);
    if (!sections.length) throw new Error('writer returned no usable sections');
    const summaryLine = sections
      .flatMap((s) => s.blocks)
      .filter((b) => b.type === 'summary')
      .map((b) => b.text)[0] ||
      `${chapter.title}: covered ${slice.map((t) => t.name).join(', ')}.`;
    const openQuestions = isArr(parsed.openQuestions)
      ? parsed.openQuestions.filter(isStr).map((s) => s.slice(0, 300)).slice(0, 10)
      : [];
    const continuityNote = isStr(parsed.continuityNote) ? parsed.continuityNote.slice(0, 500) : '';
    return { sections, summary: String(summaryLine).slice(0, 700), openQuestions, continuityNote, mode: 'ai' };
  } catch (_err) {
    return {
      sections: deterministicSections(chapter, slice, preset),
      summary: `${chapter.title}: covered ${slice.map((t) => t.name).join(', ')}.`,
      mode: 'fallback'
    };
  }
}

/**
 * Isolated Section Rewriter (master spec §11, §24)
 * Allows rewrites/expansions of a specific section without modifying other sections.
 */
async function rewriteSection({ section, action, customInstruction, presetId, kbSlice }, aiConfig) {
  if (!section || typeof section !== 'object') {
    throw new Error('Section object is required');
  }
  const preset = getPreset(presetId);
  const act = String(action || 'rewrite').toLowerCase();

  const actionDirectives = {
    rewrite: 'Rewrite and polish this section to improve clarity and flow while adhering to the preset tone.',
    expand: 'Expand this section with more in-depth explanations, thorough evidence breakdown, and supporting details.',
    condense: 'Condense this section into crisp, concise key points, removing fluff while preserving all core facts and definitions.',
    simplify: 'Simplify this section into plain, jargon-free language suitable for a beginner reader, using intuitive analogies.',
    explain: 'Provide a deeper, step-by-step conceptual explanation of the ideas in this section.',
    academic: 'Elevate this section to formal academic style, citing principles and structuring formal arguments.',
    examples: 'Add 1-2 practical, illustrative worked examples or case scenarios to this section.',
    exercises: 'Add 2-3 thoughtful practice questions or exercises with answers at the end of this section.',
    summary: 'Add a clear summary callout block and high-priority takeaways to this section.',
    takeaways: 'Extract and format the top high-yield takeaways in importance blocks.'
  };

  const directive = actionDirectives[act] || actionDirectives.rewrite;
  const extra = customInstruction ? ` Additional user instruction: ${customInstruction}` : '';

  if (!aiProvider.available(aiConfig)) {
    return { section, mode: 'fallback' };
  }

  try {
    const prompt = [
      `PRESET: ${preset.label} (${preset.tone}, reading level: ${preset.readingLevel})`,
      `GOAL: ${directive}${extra}`,
      `ORIGINAL SECTION:\n${JSON.stringify(section)}`,
      kbSlice ? `RELEVANT EVIDENCE:\n${JSON.stringify(kbSlice)}` : ''
    ].filter(Boolean).join('\n\n');

    const raw = await aiProvider.complete(
      'You are a master book editor. Transform the given book section according to the requested directive. Return STRICT JSON only: {"title":string,"blocks":[<block>]} matching the standard block schema (paragraph, definition, bullet_list, example, exercise, formula, table, warning, note, summary, quote, callout, importance).',
      prompt,
      { maxTokens: 2000, temperature: 0.4, timeoutMs: 25000 },
      aiConfig
    );
    const parsed = parseJsonLoose(raw);
    const sanitized = sanitizeBlocks([parsed]);
    if (sanitized.length && sanitized[0].blocks.length) {
      return { section: sanitized[0], mode: 'ai' };
    }
    return { section, mode: 'fallback' };
  } catch (_err) {
    return { section, mode: 'fallback' };
  }
}

module.exports = {
  writeChapter,
  rewriteSection,
  sanitizeBlocks,
  deterministicSections,
  WRITE_SYSTEM
};
