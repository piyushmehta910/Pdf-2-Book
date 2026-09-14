const { chunkPage, splitLongText, chunkUnits, unitText } = require('../src/services/chunker');

describe('chunker', () => {
  test('splits markdown into chunks with headings as sections', () => {
    const md = [
      '## Introduction',
      '',
      'This is the introduction paragraph with enough text to stand alone as a meaningful knowledge unit.',
      '',
      '## Results',
      '',
      'The study found a significant improvement across all measured outcomes after treatment.'
    ].join('\n');

    const chunks = chunkPage('src1', 3, md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].section).toBe('Introduction');
    expect(chunks.some((c) => c.section === 'Results')).toBe(true);
    expect(chunks.every((c) => c.pageNumber === 3)).toBe(true);
    expect(chunks.every((c) => c.sourceId === 'src1')).toBe(true);
  });

  test('splits long paragraphs by sentences', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} adds more detail to the argument.`).join(' ');
    const pieces = splitLongText(long, 300);
    expect(pieces.length).toBeGreaterThan(1);
    pieces.forEach((p) => {
      if (p !== pieces[pieces.length - 1]) expect(p.length).toBeLessThanOrEqual(400);
    });
  });
});

describe('chunker.chunkUnits', () => {
  test('retains sourceId, pageNumber and section while splitting typed units', () => {
    const units = [
      { id: 'u1', type: 'heading', text: 'Methods', level: 2 },
      { id: 'u2', type: 'paragraph', text: 'We selected a cohort of 120 participants and measured outcomes weekly.' },
      { id: 'u3', type: 'paragraph', text: 'A second paragraph that adds more supporting context for the analysis.' },
      { id: 'u4', type: 'table', text: 'header | value' },
      { id: 'u5', type: 'image' }
    ];
    const chunks = chunkUnits(units, { sourceId: 'src9', pageNumber: 4, maxChars: 400 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    chunks.forEach((c) => {
      expect(c.sourceId).toBe('src9');
      expect(c.pageNumber).toBe(4);
      expect(Array.isArray(c.unitIds)).toBe(true);
    });
    expect(chunks.find((c) => c.type === 'table').section).toBe('Methods');
    expect(chunks.find((c) => c.type === 'paragraph').section).toBe('Methods');
    const heading = chunks.find((c) => c.type === 'heading');
    expect(heading.content).toBe('Methods');
  });

  test('assigns Body section when no heading precedes', () => {
    const chunks = chunkUnits([{ id: 'u1', type: 'paragraph', text: 'Plain paragraph without any section heading.' }], { sourceId: 's', pageNumber: 1 });
    expect(chunks[0].section).toBe('Body');
  });

  test('splits oversized paragraphs while keeping provenance on each piece', () => {
    const longText = Array.from({ length: 30 }, (_, i) => 'Sentence ' + (i + 1) + ' of a very long paragraph covering a single idea.').join(' ');
    const chunks = chunkUnits([{ id: 'u1', type: 'paragraph', text: longText }], { sourceId: 's2', pageNumber: 2, maxChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.sourceId).toBe('s2'));
  });

  test('unitText renders definition/table text without harm', () => {
    expect(unitText({ type: 'definition', definition: 'Rotational force.' })).toBe('Rotational force.');
    expect(unitText({ type: 'table', text: 'a|b\nc|d' })).toContain('|');
    expect(unitText({ type: 'image' })).toContain('embedded image');
  });
});
