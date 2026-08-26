const aiProvider = require('./aiProvider');
const logger = require('../logger');

const BLUEPRINT_SYSTEM =
  'You are a master non-fiction book architect. Design a complete plan for a readable knowledge book built ONLY from the provided source material. Reply with STRICT JSON only (no markdown fence, no commentary) shaped exactly: {"title":string,"subtitle":string,"preface":string,"audience":string,"chapters":[{"title":string,"goal":string}]}. The preface must be 120-200 words welcoming the reader and describing what the book covers. Provide 4-8 chapters ordered as a natural learning journey. Ground every chapter in themes actually present in the sources; never invent subject matter.';

const DRAFT_SYSTEM =
  'You are an expert non-fiction author writing a real book, one passage at a time. You receive the BOOK PLAN, a RUNNING SUMMARY of everything written so far, the CURRENT CHAPTER note, and the next PAGES of source material. Continue the book seamlessly in flowing reader-friendly prose grounded strictly in those pages. Do not repeat earlier content; reference it smoothly when useful. Preserve concrete facts, numbers, definitions and examples. Never invent facts. Format: plain paragraphs separated by blank lines (no headings, no bullet lists). Finish your reply with exactly one line:\nSUMMARY_UPDATE: <2-3 sentences updating the running summary>';

const ENRICH_SYSTEM =
  'You are an expert editor deepening a book chapter with additional research. You receive the CURRENT CHAPTER TEXT and EVIDENCE from other sources. Rewrite the chapter so the new evidence is woven in naturally: add missing information, sharpen weak passages, resolve contradictions explicitly, and keep everything already correct. Ground strictly in the combined material; never invent facts. Keep roughly the same structure and order, output the FULL improved chapter as plain text with paragraph breaks (no commentary about editing).';

function condense(text, maxChars) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

function parseJsonLoose(raw) {
  try { return JSON.parse(raw); } catch (_err) { /* fall through */ }
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_err2) { return null; }
}

function sanitizeBlueprint(bp, fb) {
  const out = fb || {};
  if (!bp || typeof bp !== 'object') return out;
  if (typeof bp.title === 'string' && bp.title.trim()) out.title = bp.title.trim().slice(0, 160);
  if (typeof bp.subtitle === 'string') out.subtitle = bp.subtitle.trim().slice(0, 200);
  if (typeof bp.preface === 'string' && bp.preface.trim()) out.preface = bp.preface.trim().slice(0, 4000);
  if (typeof bp.audience === 'string') out.audience = bp.audience.trim().slice(0, 300);
  if (Array.isArray(bp.chapters)) {
    const chapters = bp.chapters
      .filter((c) => c && typeof c.title === 'string' && c.title.trim())
      .slice(0, 12)
      .map((c) => ({
        title: c.title.trim().slice(0, 140),
        goal: typeof c.goal === 'string' ? c.goal.trim().slice(0, 400) : ''
      }));
    if (chapters.length >= 2) out.chapters = chapters;
  }
  return out;
}

function fallbackBlueprint(input) {
  const titles = (input.sources || []).map((s) => s.title).filter(Boolean);
  const theme = input.theme || titles.join(', ') || 'Your Research';
  return {
    title: input.title || 'A Knowledge Book',
    subtitle: `Compiled from ${Math.max(1, titles.length)} source(s)`,
    preface: `This book gathers what your collected materials say about ${condense(theme, 180)}. It is organized as a guided journey: each chapter builds on the previous one, keeping every claim tied to its source. Read it cover to cover or jump to the chapter you need.`,
    audience: 'Curious readers who want the research, not the noise.',
    chapters: [
      { title: 'Foundations', goal: 'Core concepts and definitions from the sources.' },
      { title: 'Mechanisms & Evidence', goal: 'How things work according to the material, with supporting detail.' },
      { title: 'Open Questions', goal: 'Disagreements, limits and open problems found across sources.' }
    ]
  };
}

async function makeBlueprint(input, aiConfig) {
  const fbInput = {
    title: input.title,
    theme: (input.sources || []).map((s) => s.title).join('; '),
    sources: input.sources || []
  };
  const fb = fallbackBlueprint(fbInput);
  if (!aiProvider.available(aiConfig)) return { blueprint: fb, mode: 'fallback' };

  try {
    const srcBlock = (input.sources || [])
      .map((s) => `## Source: ${s.title}\n${condense(s.sample || '', 1600)}`)
      .join('\n\n');
    const raw = await aiProvider.complete(
      BLUEPRINT_SYSTEM,
      `Working title: ${input.title || 'Untitled'}\nBook tone: ${input.tone || 'neutral'}; depth: ${input.depth || 'standard'}.\n\nSources overview:\n${srcBlock}`,
      { maxTokens: 1800, temperature: 0.5, timeoutMs: 30000 },
      aiConfig
    );
    return { blueprint: sanitizeBlueprint(parseJsonLoose(raw), fb), mode: 'ai' };
  } catch (err) {
    logger.error(`blueprint failed: ${err.message}`);
    return { blueprint: fb, mode: 'fallback' };
  }
}

function extractSummaryUpdate(raw) {
  const idx = String(raw).lastIndexOf('SUMMARY_UPDATE:');
  if (idx === -1) return { prose: String(raw).trim(), summary: '' };
  const prose = String(raw).slice(0, idx).trim();
  const summary = String(raw).slice(idx + 'SUMMARY_UPDATE:'.length).trim();
  return { prose, summary };
}

function fallbackProse(pages) {
  const seen = new Set();
  const paras = [];
  for (const p of pages) {
    const text = condense(String(p.text || ''), 2400).replace(/([.!?])\s+(?=[A-Z])/g, '$1|').split('|');
    for (const sentence of text) {
      const s = sentence.trim();
      if (s.length < 40) continue;
      const key = s.slice(0, 90).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      paras.push(`${s} [${p.title || 'Source'}, p. ${p.pageNumber}]`);
      if (paras.length >= 14) break;
    }
    if (paras.length >= 14) break;
  }
  const body = paras.join('\n\n');
  return {
    prose: body || 'No additional detail was available for this section.',
    summary: `Covered material from ${pages.map((p) => `p.${p.pageNumber}`).join(', ')} of ${pages[0] ? pages[0].title || 'the source' : 'the source'}.`
  };
}

async function draftBatch(payload, aiConfig) {
  const pages = Array.isArray(payload.pages) ? payload.pages.slice(0, 8) : [];
  const clean = pages
    .map((p, i) => ({
      title: p && p.title ? String(p.title).slice(0, 160) : 'Source',
      pageNumber: Number(p && p.pageNumber) || i + 1,
      text: String((p && p.text) || '').slice(0, 6000)
    }))
    .filter((p) => p.text.trim().length > 20);

  if (!clean.length) {
    return { prose: '', summary: payload.summary || '', mode: 'empty', finishedHint: true };
  }

  if (!aiProvider.available(aiConfig)) {
    const fb = fallbackProse(clean.map((p) => ({ ...p, text: p.text })));
    return { prose: fb.prose, summary: `${payload.summary || ''} ${fb.summary}`.trim(), mode: 'fallback' };
  }

  try {
    const plan = payload.blueprint || {};
    const chapterList = (plan.chapters || []).map((c, i) => `${i + 1}. ${c.title} — ${c.goal}`).join('\n');
    const pagesBlock = clean.map((p) => `[[${p.title} · page ${p.pageNumber}]]\n${p.text}`).join('\n\n');

    const raw = await aiProvider.complete(
      DRAFT_SYSTEM,
      [
        `BOOK TITLE: ${plan.title || payload.title || 'Untitled'}`,
        `CHAPTERS:\n${chapterList || '(free-form)'}`,
        `CURRENT FOCUS: chapter ${payload.chapterIndex != null ? Number(payload.chapterIndex) + 1 : '?'}/` +
          `${(plan.chapters || []).length || '?'}${payload.isChapterStart ? ' (just started this chapter)' : ''}`,
        `RUNNING SUMMARY SO FAR:\n${condense(payload.summary || 'Nothing yet.', 1800)}`,
        `NEXT SOURCE PAGES:\n${pagesBlock}`
      ].join('\n\n'),
      { maxTokens: 2400, temperature: 0.55, timeoutMs: 35000 },
      aiConfig
    );
    const parts = extractSummaryUpdate(raw);
    return {
      prose: parts.prose,
      summary: parts.summary || payload.summary || '',
      mode: 'ai'
    };
  } catch (err) {
    logger.error(`draft failed: ${err.message}`);
    const fb = fallbackProse(clean);
    return { prose: fb.prose, summary: `${payload.summary || ''} ${fb.summary}`.trim(), mode: 'fallback' };
  }
}

function fallbackEnrich(chapterText, evidence) {
  const additions = evidence
    .map((e) => `- ${condense(String(e.text || ''), 320)} [${e.title || 'Source'}, p. ${e.pageNumber}]`)
    .filter((l) => l.length > 12);
  if (!additions.length) return { text: chapterText, mode: 'unchanged' };
  return {
    text: `${String(chapterText || '').trim()}\n\n### Further details from other sources\n${additions.join('\n')}`,
    mode: 'fallback'
  };
}

async function enrichChapter(payload, aiConfig) {
  const evidence = Array.isArray(payload.evidence) ? payload.evidence.slice(0, 8) : [];
  const cleanEvidence = evidence
    .map((e, i) => ({
      title: e && e.title ? String(e.title).slice(0, 160) : 'Source',
      pageNumber: Number(e && e.pageNumber) || i + 1,
      text: String((e && e.text) || '').slice(0, 5000)
    }))
    .filter((e) => e.text.trim().length > 20);

  const chapterText = String(payload.chapterText || '');
  if (!cleanEvidence.length || !chapterText.trim()) {
    return { text: chapterText, mode: 'unchanged' };
  }

  if (!aiProvider.available(aiConfig)) return fallbackEnrich(chapterText, cleanEvidence);

  try {
    const evBlock = cleanEvidence
      .map((e) => `[${e.title} · p.${e.pageNumber}]\n${e.text}`)
      .join('\n\n');
    const raw = await aiProvider.complete(
      ENRICH_SYSTEM,
      `CHAPTER: ${payload.chapterTitle || 'Untitled chapter'}\n\nCURRENT CHAPTER TEXT:\n${condense(chapterText, 9000)}\n\nEVIDENCE FROM OTHER SOURCES:\n${evBlock}`,
      { maxTokens: 2800, temperature: 0.45, timeoutMs: 35000 },
      aiConfig
    );
    const text = String(raw).trim();
    if (text.length < chapterText.length * 0.5) return fallbackEnrich(chapterText, cleanEvidence);
    return { text, mode: 'ai' };
  } catch (err) {
    logger.error(`enrich failed: ${err.message}`);
    return fallbackEnrich(chapterText, cleanEvidence);
  }
}

module.exports = {
  makeBlueprint,
  draftBatch,
  enrichChapter,
  fallbackBlueprint,
  fallbackProse,
  fallbackEnrich,
  parseJsonLoose,
  extractSummaryUpdate
};
