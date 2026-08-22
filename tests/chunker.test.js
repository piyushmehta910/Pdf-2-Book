const { chunkPage, splitLongText } = require('../src/services/chunker');

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
