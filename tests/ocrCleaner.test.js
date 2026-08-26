const { cleanOcr } = require('../src/services/ocrCleaner');

describe('ocrCleaner', () => {
  test('joins words broken by line-end hyphens', () => {
    const { cleaned } = cleanOcr('The neural network is a computa-\ntional model.');
    expect(cleaned).toContain('computational model');
    expect(cleaned).not.toContain('computa-');
  });

  test('keeps intentional hyphens inside lines untouched', () => {
    const { cleaned } = cleanOcr('a state-of-the-art method');
    expect(cleaned).toBe('a state-of-the-art method');
  });

  test('normalizes bullets and repeated blank lines', () => {
    const { cleaned } = cleanOcr('• first item\n\n\n\n· second item');
    expect(cleaned).toContain('- first item');
    expect(cleaned).toContain('- second item');
    expect(cleaned).not.toMatch(/\n{3,}/);
  });

  test('strips control characters and soft hyphens', () => {
    const { cleaned } = cleanOcr('invi\u00ADsible\u0000text\u200Bhere');
    expect(cleaned).toBe('invisibletexthere');
  });

  test('never alters factual content: numbers preserved', () => {
    const src = 'Protein intake of 1.6 g per kg per day maximizes muscle protein synthesis.';
    expect(cleanOcr(src).cleaned).toBe(src);
  });

  test('is idempotent', () => {
    const src = 'Some-\nwhat messy   text\u0000 with\n\n\n\nartifacts • and bullets';
    const once = cleanOcr(src);
    const twice = cleanOcr(once.cleaned);
    expect(twice.cleaned).toBe(once.cleaned);
  });

  test('reports stats', () => {
    const { stats } = cleanOcr('exam-\nple');
    expect(stats.dehyphenated).toBeGreaterThanOrEqual(1);
  });
});
