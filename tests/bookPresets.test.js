const bookPresets = require('../src/services/bookPresets');

describe('bookPresets', () => {
  test('exposes all sixteen presets via describe()', () => {
    const list = bookPresets.describe();
    expect(list).toHaveLength(16);
    const ids = list.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([
      'academic', 'textbook', 'research', 'technical', 'selfhelp',
      'business', 'biography', 'novel', 'guide', 'manual',
      'studyguide', 'coursebook', 'children', 'reference', 'report', 'custom'
    ]));
    for (const p of list) {
      expect(p.label).toBeTruthy();
      expect(p.blurb).toBeTruthy();
      expect(typeof p.include).toBe('object');
    }
  });

  test('exposes 9 design systems and 6 page sizes', () => {
    const designs = bookPresets.describeDesigns();
    expect(designs).toHaveLength(9);
    const pageSizes = bookPresets.describePageSizes();
    expect(pageSizes).toHaveLength(6);
  });

  test('getPreset falls back to textbook for unknown ids', () => {
    expect(bookPresets.getPreset('nope').id).toBe('textbook');
    expect(bookPresets.getPreset('exam').id).toBe('textbook');
    expect(bookPresets.getPreset('academic').label).toBe('Academic Book');
  });

  test('presetExists distinguishes real vs unknown ids', () => {
    expect(bookPresets.presetExists('technical')).toBe(true);
    expect(bookPresets.presetExists('quick')).toBe(false);
  });

  test('validateCustomPreset sanitizes and caps user input', () => {
    const out = bookPresets.validateCustomPreset({
      label: 'x'.repeat(100),
      tone: 'playful',
      include: { examples: false, exercises: true, nonsense: true },
      evil: 'drop-table'
    });
    expect(out.label.length).toBeLessThanOrEqual(40);
    expect(out.tone).toBe('playful');
    expect(out.include.examples).toBe(false);
    expect(out.include.exercises).toBe(true);
    expect(out.include).not.toHaveProperty('nonsense');
    expect(out.isCustom).toBe(true);
  });

  test('validateCustomPreset tolerates garbage input', () => {
    expect(bookPresets.validateCustomPreset(null).id).toBe('custom');
    expect(bookPresets.validateCustomPreset('junk').include.toc).toBe(true);
  });

  test('every preset carries blueprint and draft addenda except custom defaults', () => {
    for (const id of ['academic', 'textbook', 'research', 'technical', 'selfhelp', 'business', 'biography', 'novel', 'guide', 'manual', 'studyguide', 'coursebook', 'children', 'reference', 'report']) {
      const p = bookPresets.getPreset(id);
      expect(p.blueprintAddendum.length).toBeGreaterThan(10);
      expect(p.draftAddendum.length).toBeGreaterThan(10);
    }
  });
});
