const { isLikelyHeading, pageToMarkdown } = require('../src/services/markdownConverter');

describe('markdownConverter', () => {
  test('detects common section headings', () => {
    expect(isLikelyHeading('Abstract')).toBe(true);
    expect(isLikelyHeading('2. Methodology')).toBe(true);
    expect(isLikelyHeading('3.2 Study Population')).toBe(true);
  });

  test('does not treat normal sentences as headings', () => {
    expect(isLikelyHeading('The results of this experiment were consistent with prior work.')).toBe(false);
  });

  test('converts page text to markdown with heading levels', () => {
    const md = pageToMarkdown('Abstract\n\nWe studied the effects.\n\n1. Introduction\n\nBackground here.', 2);
    expect(md).toContain('<!-- page 2 -->');
    expect(md).toContain('## Abstract');
    expect(md).toContain('## Introduction');
  });
});
