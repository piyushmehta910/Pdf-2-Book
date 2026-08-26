const request = require('supertest');
const fs = require('fs');
const path = require('path');

const TEST_DATA = path.resolve(__dirname, '../.test-data-nb');
process.env.DATA_DIR = TEST_DATA;

const app = require('../src/server');
const { validateNotebook, buildPromptAddenda, FORMATS } = require('../src/services/notebookOptions');
const { synthesizeTopic, parseCardBlocks, parseFlashcardPairs } = require('../src/services/synthesizer');
const { composeChapters } = require('../src/services/chapterComposer');
const exporter = require('../src/services/exporter');
const storage = require('../src/services/storage');

function makeChunk(id, sourceId, content, page) {
  return { id, sourceId, content, pageNumber: page || 1 };
}

describe('notebookOptions', () => {
  test('validates and clamps options', () => {
    const nb = validateNotebook({ style: 'bogus', format: 'wiki', depth: 42, tone: 'enthusiastic', includeQuotes: false });
    expect(nb.style).toBe('scholar');
    expect(nb.format).toBe('wiki');
    expect(nb.depth).toBe('standard');
    expect(nb.tone).toBe('enthusiastic');
    expect(nb.includeQuotes).toBe(false);
  });

  test('builds prompt addenda with citation rules', () => {
    const { system, user } = buildPromptAddenda(validateNotebook({ format: 'flashcards' }));
    expect(system).toMatch(/Knowledge Synthesis/);
    expect(user).toMatch(/Q: <specific question>/);
    expect(user).toMatch(/\[Source:/);
  });
});

describe('format parsers', () => {
  test('parses CARD blocks', () => {
    const raw = 'intro\nCARD\nFront: What is X?\nBack: X is a thing.\nCARD\nFront: Q2\nBack: A2';
    const cards = parseCardBlocks(raw);
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toBe('What is X?');
    expect(cards[1].back).toBe('A2');
  });

  test('parses flashcard pairs', () => {
    const raw = 'Q: One?\nA: First answer.\nQ: Two?\nA: Second answer.';
    const cards = parseFlashcardPairs(raw);
    expect(cards).toHaveLength(2);
    expect(cards[1].front).toBe('Two?');
  });
});

describe('synthesizeTopic fallback formats (no AI key)', () => {
  const sources = [{ id: 'src_1', title: 'Deep Learning Primer' }];
  const chunks = [
    makeChunk('ck_1', 'src_1', 'Backpropagation computes gradients using the chain rule. It propagates error backward through layers.'),
    makeChunk('ck_2', 'src_1', 'Learning rate controls step size. Too high a learning rate diverges.')
  ];
  const topic = { id: 'top_1', name: 'Backpropagation', keywords: ['backpropagation', 'gradient'], chunkIds: ['ck_1', 'ck_2'] };

  test('book format yields prose with citations', async () => {
    const syn = await synthesizeTopic(topic, chunks, sources, {}, { format: 'book' });
    expect(syn.content).toMatch(/## Backpropagation|Backpropagation/);
    expect(syn.content).toContain('[Source: Deep Learning Primer');
    expect(syn.content).toContain('### References');
  });

  test('outline format yields nested bullets only', async () => {
    const syn = await synthesizeTopic(topic, chunks, sources, {}, { format: 'outline' });
    expect(syn.content).toMatch(/^- \*\*Backpropagation\*\*/m);
    expect(syn.content).not.toMatch(/^#[^#]/m);
    expect(syn.cards).toEqual([]);
  });

  test('cards format produces structured cards', async () => {
    const syn = await synthesizeTopic(topic, chunks, sources, {}, { format: FORMATS.cards.id ? 'cards' : 'cards' });
    expect(syn.cards.length).toBeGreaterThan(0);
    expect(syn.cards[0]).toHaveProperty('front');
    expect(syn.cards[0]).toHaveProperty('back');
  });

  test('flashcards format produces Q/A cards without references block', async () => {
    const syn = await synthesizeTopic(topic, chunks, sources, {}, { format: 'flashcards' });
    expect(syn.cards.length).toBe(2);
    expect(syn.content).toMatch(/Q: /);
    expect(syn.content).not.toContain('### References');
  });

  test('outline fallback has no references block but inline citations', async () => {
    const syn = await synthesizeTopic(topic, chunks, sources, {}, { format: 'outline' });
    expect(syn.content).not.toContain('### References');
    expect(syn.content).toContain('Deep Learning Primer');
  });
});

describe('composeChapters', () => {
  const topics = [
    { id: 'top_1', name: 'Gradient Descent Methods', keywords: ['descent'] },
    { id: 'top_2', name: 'Descent Optimization Practice', keywords: ['optimization'] }
  ];
  const outline = {
    chapters: [
      { id: 'ch_1', title: 'Chapter One', number: 1, sections: [], topics: [topics[0]] },
      { id: 'ch_2', title: 'Chapter Two', number: 2, sections: [], topics: [topics[1]] }
    ]
  };

  function mkSyn(topicId) {
    return { topicId, content: `Note for ${topicId} [Source: S1, p. 1]`, cards: [], sourceIds: [] };
  }

  test('concatenates without polish when no AI key', async () => {
    const { chapters, polished } = await composeChapters({
      outline,
      syntheses: [mkSyn('top_1'), mkSyn('top_2')],
      notebook: validateNotebook({ format: 'book' }),
      aiConfig: {},
      topics
    });
    expect(polished).toBe(false);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].content).toContain('# Chapter One');
    expect(chapters[0].type).toBe('chapter');
  });

  test('adds knowledge gaps appendix from weak coverage', async () => {
    const coverage = [{ topicId: 'top_1', topicName: 'Sparse Topic', score: 20, chunkCount: 1, insufficient: true }];
    const { chapters } = await composeChapters({
      outline: { chapters: [outline.chapters[0]] },
      syntheses: [mkSyn('top_1')],
      notebook: validateNotebook({ knowledgeGaps: true, glossary: false }),
      aiConfig: {},
      topics,
      coverage
    });
    const gaps = chapters.find((c) => c.type === 'appendix');
    expect(gaps).toBeTruthy();
    expect(gaps.content).toContain('Sparse Topic');
  });

  test('glossary appendix built from topic keywords found in chunks', async () => {
    const chunkList = [makeChunk('ck_g', 'src_x', 'Optimization theory studies iterative improvement methods.')];
    const kwTopics = [{ id: 't9', name: 'Methods Overview', keywords: ['optimization', 'iterative'], chunkIds: ['ck_g'] }];
    const { chapters } = await composeChapters({
      outline: { chapters: [] },
      syntheses: [],
      notebook: validateNotebook({ glossary: true, knowledgeGaps: false }),
      aiConfig: {},
      topics: kwTopics,
      coverage: [],
      chunks: chunkList
    });
    const gl = chapters.find((c) => c.id === 'ch_glossary');
    expect(gl).toBeTruthy();
    expect(gl.content).toContain('**optimization**');
  });

  test('wiki format appends Related links between overlapping chapters', async () => {
    const sharedTopics = [
      { id: 'w1', name: 'Neural Network Training Dynamics', keywords: ['training'] },
      { id: 'w2', name: 'Training Dynamics of Networks', keywords: ['dynamics'] }
    ];
    const wikiOutline = {
      chapters: [
        { id: 'wc1', title: 'Neural Network Training Dynamics', number: 1, sections: [], topics: [sharedTopics[0]] },
        { id: 'wc2', title: 'Training Dynamics of Networks', number: 2, sections: [], topics: [sharedTopics[1]] }
      ]
    };
    const { chapters } = await composeChapters({
      outline: wikiOutline,
      syntheses: [mkSyn('w1'), mkSyn('w2')],
      notebook: validateNotebook({ format: 'wiki' }),
      aiConfig: {},
      topics: sharedTopics
    });
    expect(chapters[0].content).toMatch(/\[\[.+?\]\]/);
  });
});

describe('exporter format renderers', () => {
  test('flashcards CSV export', () => {
    const csv = exporter.toFlashcardsCsv([
      { title: 'Ch 1', cards: [{ front: 'What is "X", exactly?', back: 'line1\nline2' }] }
    ]);
    expect(csv).toContain('Front,Back,Chapter');
    expect(csv).toContain('"What is ""X"", exactly?"');
  });

  test('csv returns null when no cards', () => {
    expect(exporter.toFlashcardsCsv([{ title: 'C', cards: [] }])).toBeNull();
  });

  test('markdown export includes table of contents', () => {
    const md = exporter.toMarkdown(
      { title: 'T' },
      [
        { type: 'chapter', title: 'A', content: '# A\n\ntext' },
        { type: 'chapter', title: 'B', content: '# B\n\ntext' },
        { type: 'appendix', title: 'Appendix', content: '# Appendix' }
      ]
    );
    expect(md).toContain('## Contents');
    expect(md).toContain('1. A');
    expect(md).not.toContain('3. # Appendix');
  });

  test('html renderer nests lists and converts wiki links', () => {
    const html = exporter.markdownToHtml('- top\n  - child', { wikiLinks: true });
    expect((html.match(/<ul>/g) || []).length).toBe(2);
    const wikiHtml = exporter.markdownToHtml('See [[Backpropagation]] here.', { wikiLinks: true });
    expect(wikiHtml).toContain('class="wikilink"');
    expect(wikiHtml).toContain('href="#backpropagation"');
  });

  test('html export renders flashcard blocks', () => {
    const html = exporter.toHtml(
      { title: 'Deck' },
      [{ type: 'chapter', title: 'Cards Ch', content: '# x', cards: [{ front: 'F1', back: 'B1' }] }],
      { format: 'flashcards' }
    );
    expect(html).toContain('class="fcard"');
    expect(html).toContain('Q1. F1');
  });
});

describe('project notebook persistence API', () => {
  let projectId;

  afterAll(() => {
    if (fs.existsSync(TEST_DATA)) fs.rmSync(TEST_DATA, { recursive: true });
  });

  test('PATCH saves validated notebook onto project', async () => {
    const created = await request(app).post('/api/projects').send({ title: 'NB Project' });
    projectId = created.body.id;
    const res = await request(app)
      .patch('/api/projects/' + projectId)
      .send({ notebook: { style: 'storyteller', format: 'flashcards', depth: 'deep', tone: 123, glossary: true } });
    expect(res.status).toBe(200);
    expect(res.body.notebook.style).toBe('storyteller');
    expect(res.body.notebook.format).toBe('flashcards');
    expect(res.body.notebook.depth).toBe('deep');
    expect(res.body.notebook.tone).toBe('neutral');
    expect(res.body.notebook.glossary).toBe(true);
    const stored = storage.readCollection(projectId, 'project')[0];
    expect(stored.notebook.crossRefDensity).toBe('medium');
  });

  test('GET /api/notebook is retired (presets supersede quick modes)', async () => {
    const res = await request(app).get('/api/notebook');
    expect(res.status).toBe(404);
  });
});
