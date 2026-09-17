const tl = require('../public/themeLayer');
const bookPresets = require('../src/services/bookPresets');

describe('Book Size presets and conversion/validation suite', () => {
  const EXPECTED_PRESET_IDS = ['a5', 'a4', 'size_5x8', 'digest_55x85', 'trade_6x9', 'size_8x10'];

  test('exposes exactly the 6 requested presets in exact order', () => {
    expect(tl.PAGE_SIZE_IDS).toEqual(EXPECTED_PRESET_IDS);
    expect(bookPresets.describePageSizes().map((p) => p.id)).toEqual(EXPECTED_PRESET_IDS);
  });

  test('each preset has exact dimensions and matching label', () => {
    const a5 = tl.getPageSize('a5');
    expect(a5.label).toBe('A5 — 148 × 210 mm');
    expect(a5.widthMm).toBe(148);
    expect(a5.heightMm).toBe(210);

    const a4 = tl.getPageSize('a4');
    expect(a4.label).toBe('A4 — 210 × 297 mm');
    expect(a4.widthMm).toBe(210);
    expect(a4.heightMm).toBe(297);

    const s5x8 = tl.getPageSize('size_5x8');
    expect(s5x8.label).toBe('5 × 8 in');
    expect(s5x8.widthIn).toBe(5);
    expect(s5x8.heightIn).toBe(8);
    expect(s5x8.widthMm).toBe(127);
    expect(s5x8.heightMm).toBe(203.2);

    const d55x85 = tl.getPageSize('digest_55x85');
    expect(d55x85.label).toBe('5.5 × 8.5 in');
    expect(d55x85.widthIn).toBe(5.5);
    expect(d55x85.heightIn).toBe(8.5);

    const t6x9 = tl.getPageSize('trade_6x9');
    expect(t6x9.label).toBe('6 × 9 in');
    expect(t6x9.widthIn).toBe(6);
    expect(t6x9.heightIn).toBe(9);
    expect(t6x9.widthMm).toBe(152.4);
    expect(t6x9.heightMm).toBe(228.6);

    const s8x10 = tl.getPageSize('size_8x10');
    expect(s8x10.label).toBe('8 × 10 in');
    expect(s8x10.widthIn).toBe(8);
    expect(s8x10.heightIn).toBe(10);
    expect(s8x10.widthMm).toBe(203.2);
    expect(s8x10.heightMm).toBe(254);
  });

  test('converts accurately between mm, cm, and inches', () => {
    expect(tl.convertUnit(6, 'inches', 'mm')).toBe(152.4);
    expect(tl.convertUnit(152.4, 'mm', 'inches')).toBe(6);
    expect(tl.convertUnit(152.4, 'mm', 'cm')).toBe(15.24);
    expect(tl.convertUnit(15.24, 'cm', 'mm')).toBe(152.4);
    expect(tl.convertUnit(15.24, 'cm', 'inches')).toBe(6);
    expect(tl.convertUnit(9, 'inches', 'mm')).toBe(228.6);
    expect(tl.convertUnit(228.6, 'mm', 'inches')).toBe(9);
  });

  test('allows decimal values and validates > 0 and bounds', () => {
    const decValid = tl.validateDimensions(5.5, 8.5, 'inches');
    expect(decValid.valid).toBe(true);
    expect(decValid.widthIn).toBe(5.5);
    expect(decValid.heightIn).toBe(8.5);

    expect(tl.validateDimensions(0, 10, 'inches').valid).toBe(false);
    expect(tl.validateDimensions(6, -2, 'inches').valid).toBe(false);
    expect(tl.validateDimensions('abc', 10, 'mm').valid).toBe(false);

    const tooLarge = tl.validateDimensions(1500, 2000, 'mm');
    expect(tooLarge.valid).toBe(false);
    expect(tooLarge.error).toMatch(/exceed/i);

    const tooSmall = tl.validateDimensions(5, 10, 'mm');
    expect(tooSmall.valid).toBe(false);
    expect(tooSmall.error).toMatch(/at least/i);
  });

  test('formats dual metric and imperial dimensions', () => {
    const dual = tl.formatDualDimensions(152.4, 228.6, 'mm');
    expect(dual.metric).toBe('152.4 × 228.6 mm');
    expect(dual.imperial).toBe('6 × 9 in');
  });

  test('createCustomPageSize stores exact dimensions and handles swap correctly', () => {
    const custom = tl.createCustomPageSize({ width: 152.4, height: 228.6, unit: 'mm' });
    expect(custom.id).toBe('custom');
    expect(custom.isCustom).toBe(true);
    expect(custom.widthMm).toBe(152.4);
    expect(custom.heightMm).toBe(228.6);
    expect(custom.widthIn).toBe(6);
    expect(custom.heightIn).toBe(9);
    expect(custom.cssSize).toBe('6in 9in');

    const swapped = tl.createCustomPageSize({ width: 228.6, height: 152.4, unit: 'mm' });
    expect(swapped.widthIn).toBe(9);
    expect(swapped.heightIn).toBe(6);
    expect(swapped.widthMm).toBe(228.6);
    expect(swapped.heightMm).toBe(152.4);
  });

  test('preserves backward-compatible resolution for legacy letter', () => {
    const letter = tl.getPageSize('letter');
    expect(letter.widthIn).toBe(8.5);
    expect(letter.heightIn).toBe(11);
  });
});