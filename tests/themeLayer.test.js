const tl = require('../public/themeLayer');

const REQUIRED_THEME_KEYS = [
  'id', 'label', 'fontFamily', 'headingFont', 'monoFont',
  'baseFontSize', 'lineHeight', 'primaryColor', 'secondaryColor',
  'backgroundColor', 'textColor', 'headingColor', 'borderColor', 'accentBackground',
  'dropCap', 'headerStyle', 'pageNumberStyle', 'marginsMm',
  'paragraphSpacing', 'headingStyle', 'chapterOpener', 'bodyAlign'
];

describe('themeLayer', () => {
  test('exposes 9 themes with the full token set', () => {
    expect(tl.THEME_IDS).toHaveLength(9);
    for (const id of tl.THEME_IDS) {
      const t = tl.getTheme(id);
      expect(t.id).toBe(id);
      for (const key of REQUIRED_THEME_KEYS) {
        expect(t).toHaveProperty(key);
      }
      expect(typeof t.primaryColor).toBe('string');
      expect(typeof t.baseFontSize).toBe('string');
      expect(t.lineHeight).toBeGreaterThan(1);
      expect(t.marginsMm).toHaveProperty('top');
      expect(t.marginsMm).toHaveProperty('bottom');
      expect(t.marginsMm).toHaveProperty('inner');
      expect(t.marginsMm).toHaveProperty('outer');
    }
  });

  test('preserves backward-compatible token names', () => {
    const t = tl.getTheme('luxury');
    expect(t.fontFamily).toBeTruthy();
    expect(t.headingFont).toBeTruthy();
    expect(t.baseFontSize).toBeTruthy();
    expect(t.lineHeight).toBeGreaterThan(1);
    expect(t.primaryColor).toBeTruthy();
    expect(t.secondaryColor).toBeTruthy();
    expect(t.backgroundColor).toBeTruthy();
    expect(t.textColor).toBeTruthy();
  });

  test('exposes 5 page size presets plus a custom factory', () => {
    expect(tl.PAGE_SIZE_IDS).toEqual(['a4', 'a5', 'letter', 'trade_6x9', 'digest_55x85']);
    for (const id of tl.PAGE_SIZE_IDS) {
      const ps = tl.getPageSize(id);
      expect(ps.id).toBe(id);
      expect(ps.label).toBeTruthy();
      expect(ps.widthIn).toBeGreaterThan(0);
      expect(ps.heightIn).toBeGreaterThan(0);
    }
    const custom = tl.createCustomPageSize({ widthIn: 8.5, heightIn: 11 });
    expect(custom.id).toBe('custom');
    expect(custom.isCustom).toBe(true);
    expect(tl.getPageSize('custom', custom).widthIn).toBe(8.5);
    expect(tl.REFERENCE_WIDTH_IN).toBe(6);
  });

  test('resolvePageModel produces sane geometry for every theme x size', () => {
    for (const tid of tl.THEME_IDS) {
      for (const sid of tl.PAGE_SIZE_IDS) {
        const m = tl.resolvePageModel(tl.getTheme(tid), tl.getPageSize(sid));
        expect(m.w).toBe(Math.round(m.widthIn * 96));
        expect(m.h).toBe(Math.round(m.heightIn * 96));
        expect(m.textW).toBeGreaterThan(0);
        expect(m.textH).toBeGreaterThan(0);
        expect(m.baseFont).toBeGreaterThan(8);
        expect(m.lineHeight).toBeGreaterThan(1);
        expect(m.mT + m.mB + m.headerH + m.footerH + m.textH).toBeLessThanOrEqual(m.h + 2);
        expect(m.textW + m.mL + m.mR).toBeLessThanOrEqual(m.w + 1);
        expect(m.mb).toBeGreaterThan(0);
      }
    }
  });

  test('font scale is clamped relative to the 6x9 reference size', () => {
    const t = tl.getTheme('modern');
    const basePx = tl.parseSizePx(t.baseFontSize);
    const ref = tl.resolvePageModel(t, tl.getPageSize('trade_6x9'));
    expect(ref.baseFont).toBeCloseTo(basePx, 5);
    const letter = tl.resolvePageModel(t, tl.getPageSize('letter'));
    expect(letter.baseFont).toBeCloseTo(basePx * 1.2, 2);
    const digest = tl.resolvePageModel(t, tl.getPageSize('digest_55x85'));
    expect(digest.baseFont).toBeCloseTo(basePx * (5.5 / 6), 2);
  });

  test('autoMarginsMm scales margins with page dimensions', () => {
    const t = tl.getTheme('technical');
    const digest = tl.autoMarginsMm(t, 5.5, 8.5);
    const letter = tl.autoMarginsMm(t, 8.5, 11);
    expect(letter.outer).toBeGreaterThan(digest.outer);
    expect(letter.top).toBeGreaterThan(digest.top);
    const big = tl.autoMarginsMm(t, 1, 1);
    expect(big.outer).toBeGreaterThanOrEqual(9);
  });

  test('custom page size flows through resolvePageModel', () => {
    const m = tl.resolvePageModel(tl.getTheme('modern'), 'custom', { widthIn: 8.5, heightIn: 11, label: 'C' });
    expect(m.w).toBe(816);
    expect(m.h).toBe(1056);
    expect(m.sizeId).toBe('custom');
    expect(m.isCustom).toBe(true);
  });

  test('mmToPx and parseSizePx convert correctly', () => {
    expect(tl.mmToPx(25.4)).toBeCloseTo(96, 5);
    expect(tl.parseSizePx('14.5px')).toBeCloseTo(14.5, 5);
    expect(tl.parseSizePx('12pt')).toBeCloseTo(16, 5);
    expect(tl.parseSizePx('1em')).toBe(1);
  });

  test('paginate preserves exact content order across themes x sizes', () => {
    let seed = 1234567;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const tid of tl.THEME_IDS) {
      for (const sid of tl.PAGE_SIZE_IDS) {
        const m = tl.resolvePageModel(tl.getTheme(tid), tl.getPageSize(sid));
        const items = [];
        for (let i = 0; i < 120; i++) {
          items.push({ key: `it${i}`, h: 18 + Math.floor(rand() * Math.max(60, Math.floor(m.textH * 0.55))) });
        }
        const pages = tl.paginate(items, m);
        const flat = tl.flattenPages(pages);
        expect(flat.length).toBe(items.length);
        expect(flat).toEqual(items.map((it) => it.key));
        const seen = {};
        for (const k of flat) { expect(seen[k]).toBeUndefined(); seen[k] = true; }
        for (const page of pages) {
          const total = page.reduce((sum, k) => sum + items.find((it) => it.key === k).h, 0);
          expect(total).toBeLessThanOrEqual(m.textH + 2);
        }
      }
    }
  });

  test('paginate keeps oversized items on their own page', () => {
    const m = tl.resolvePageModel(tl.getTheme('modern'), tl.getPageSize('trade_6x9'));
    const items = [
      { key: 'a', h: 40 },
      { key: 'big', h: m.textH * 2 },
      { key: 'b', h: 40 }
    ];
    const pages = tl.paginate(items, m);
    const bigPage = pages.find((p) => p.includes('big'));
    expect(bigPage).toEqual(['big']);
  });

  test('header and page-number style lookup maps exist', () => {
    for (const id of tl.THEME_IDS) {
      const t = tl.getTheme(id);
      expect(tl.HEADER_STYLES[t.headerStyle]).toBeTruthy();
      expect(tl.PAGE_NUM_STYLES[t.pageNumberStyle]).toBeTruthy();
      expect(tl.OPENER_STYLES[t.chapterOpener]).toBeTruthy();
      expect(tl.HEADING_STYLES[t.headingStyle]).toBeTruthy();
    }
  });
});