const bookWriter = require('../src/services/bookWriter');

const SLICE = [
  {
    id: 't_gd',
    name: 'Gradient Descent',
    summary: 'Iterative first-order optimizer.',
    definitions: [{ term: 'Gradient Descent', text: 'An optimizer that follows the negative gradient.' }],
    facts: [{ text: 'Gradient descent updates model weights iteratively.' }, { text: 'Learning rate controls step size.' }],
    formulas: [{ text: 'w := w - lr * dL/dw' }],
    procedures: [],
    examples: [],
    terminology: []
  },
  {
    id: 't_lr',
    name: 'Learning Rate',
    summary: '',
    definitions: [],
    facts: [{ text: 'Too high a learning rate can diverge.' }],
    formulas: [],
    procedures: [],
    examples: [],
    terminology: []
  }
];

describe('bookWriter.sanitizeBlocks', () => {
  test('keeps valid block types and drops malformed ones', () => {
    const out = bookWriter.sanitizeBlocks([{
      title: 'S1',
      blocks: [
        { type: 'paragraph', text: 'Hello world' },
        { type: 'paragraph' },
        { type: 'definition', term: 'LR', definition: 'Step size' },
        { type: 'bullet_list', items: ['a', 'b'] },
        { type: 'bullet_list', items: [] },
        { type: 'formula', expression: 'y = mx + b', explanation: 'line' },
        { type: 'table', headers: ['A'], rows: [['1']] },
        { type: 'alien' },
        'not-an-object'
      ]
    }]);
    expect(out).toHaveLength(1);
    const types = out[0].blocks.map((b) => b.type);
    expect(types).toEqual(['paragraph', 'definition', 'bullet_list', 'formula', 'table']);
  });

  test('returns [] for garbage input', () => {
    expect(bookWriter.sanitizeBlocks(null)).toEqual([]);
    expect(bookWriter.sanitizeBlocks('x')).toEqual([]);
  });
});

describe('bookWriter.deterministicSections (keyless)', () => {
  test('converts KB slice into standalone blocks per topic', () => {
    const preset = require('../src/services/bookPresets').getPreset('textbook');
    const sections = bookWriter.deterministicSections({ title: 'Optimization', purpose: '' }, SLICE, preset);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe('Optimization');
    const flat = sections.flatMap((s) => s.blocks);
    expect(flat.some((b) => b.type === 'definition')).toBe(true);
    expect(flat.some((b) => b.type === 'formula' && /dL\/dw/.test(b.expression))).toBe(true);
    expect(flat.some((b) => b.type === 'summary')).toBe(true);
  });

  test('appends source labels when preset.include.sources is on', () => {
    const preset = require('../src/services/bookPresets').getPreset('research');
    const slice = JSON.parse(JSON.stringify(SLICE));
    slice[0].facts[0].source_ref = { document_id: 'd1', page: 4, file_name: 'ml.pdf' };
    const sections = bookWriter.deterministicSections({ title: 'T' }, slice, preset);
    const bullets = sections.flatMap((s) => s.blocks).find((b) => b.type === 'bullet_list');
    expect(bullets.items.some((i) => /\[ml\.pdf, p\.4\]/.test(i))).toBe(true);
  });

  test('splits procedure steps on pipe separators into list items', () => {
    const preset = require('../src/services/bookPresets').getPreset('handbook');
    const sections = bookWriter.deterministicSections(
      { title: 'HowTo' },
      [{
        name: 'Deploy', facts: [], definitions: [], examples: [], formulas: [],
        procedures: [{ text: '1. Build | 2. Test | 3. Ship' }]
      }],
      preset
    );
    const items = sections[0].blocks.find((b) => b.type === 'bullet_list').items;
    expect(items).toEqual(['Build', 'Test', 'Ship']);
  });
});

describe('bookWriter.writeChapter keyless mode', () => {
  test('produces fallback sections and a summary line without a key', async () => {
    const { sections, summary, mode } = await bookWriter.writeChapter(
      { title: 'B', chapter: { title: 'Optimization', purpose: '' }, presetId: 'textbook', kbSlice: SLICE, recentSummaries: [] },
      null
    );
    expect(mode).toBe('fallback');
    expect(sections.length).toBeGreaterThan(0);
    expect(summary).toMatch(/covered/i);
  });

  test('falls back when AI returns unusable JSON', async () => {
    jest.mock('../src/services/aiProvider', () => ({
      available: () => true,
      complete: async () => 'not json at all'
    }));
    jest.resetModules();
    const writer = require('../src/services/bookWriter');
    const { mode } = await writer.writeChapter(
      { title: 'B', chapter: { title: 'C1' }, presetId: 'studyguide', kbSlice: SLICE, recentSummaries: [] },
      { provider: 'zen', apiKey: 'k' }
    );
    expect(mode).toBe('fallback');
  });
});

describe('bookWriter.evidenceFromKbSlice', () => {
  test('flattens sourced facts/definitions into citation evidence', () => {
    const slice = JSON.parse(JSON.stringify(SLICE));
    slice[0].facts[0].source_ref = { document_id: 'd1', page: 4, section: 'Intro' };
    slice[0].facts[1].source_ref = { document_id: 'd1', page: 5 };
    slice[0].definitions[0].source_ref = { document_id: 'd1', page: 6 };
    const evidence = bookWriter.evidenceFromKbSlice(slice, [{ id: 'd1', name: 'ml.pdf' }]);
    const fact = evidence.find((e) => e.content.indexOf('iteratively') >= 0);
    expect(fact).toBeTruthy();
    expect(fact.sourceId).toBe('d1');
    expect(fact.page).toBe(4);
    expect(fact.section).toBe('Intro');
    expect(evidence.every((e) => e.sourceId && e.content)).toBe(true);
  });

  test('never drops a record: placeholder source id when no ref is given', () => {
    const evidence = bookWriter.evidenceFromKbSlice(SLICE, []);
    expect(evidence.length).toBeGreaterThanOrEqual(5);
    expect(evidence.every((e) => e.sourceId)).toBe(true);
  });
});

describe('bookWriter grounded fallback write', () => {
  test('attaches citations with sourceId + page to generated blocks', async () => {
    const slice = [
      {
        id: 't1',
        name: 'Gradient Descent',
        summary: '',
        facts: [{ text: 'Gradient descent updates model weights iteratively using the loss gradient.', source_ref: { document_id: 'd1', page: 4, section: 'Math' } }],
        definitions: [],
        formulas: [],
        procedures: [],
        examples: []
      }
    ];
    const { sections } = await bookWriter.writeChapter(
      { title: 'B', chapter: { title: 'T' }, presetId: 'textbook', kbSlice: slice },
      null
    );
    const blocks = sections.flatMap((s) => s.blocks);
    const cited = blocks.filter((b) => b.citations && b.citations.length);
    expect(cited.length).toBeGreaterThan(0);
    cited.forEach((b) => {
      b.citations.forEach((c) => {
        expect(typeof c.page).toBe('number');
        expect(c.sourceId).toBeTruthy();
      });
      expect(b.sourceRef).toBeTruthy();
    });
  });
});
