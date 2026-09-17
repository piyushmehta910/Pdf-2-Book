/**
 * themeLayer.js — Single source of truth for the Design/Theme layer.
 *
 * Themes are pure data objects (fonts, sizes, line-height, margins, heading
 * styles, chapter openers, page number placement, header/footer styles).
 * Page sizes are physical dimension presets plus a custom factory. The pure
 * `paginate` helper turns content items into page plans; it is theme/page-size
 * agnostic about WHICH content appears, so the same book renders identical
 * content under every theme/size combination.
 *
 * UMD: load in the browser as a global `ThemeLayer`, or `require()` it in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ThemeLayer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IN_PER_MM = 1 / 25.4;
  var PX_PER_IN = 96;
  var DEFAULT_THEME_ID = 'modern';
  var DEFAULT_PAGE_SIZE_ID = 'trade_6x9';

  /* ------------------------------------------------------------------ *
   *  THEMES — complete design data objects (no hardcoded per-book CSS)
   * ------------------------------------------------------------------ */
  var THEMES = {
    modern: {
      id: 'modern', label: 'Modern',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      headingFont: '"Inter", sans-serif',
      monoFont: '"JetBrains Mono", "Fira Code", monospace',
      baseFontSize: '14.5px',
      lineHeight: 1.6,
      primaryColor: '#6366f1', secondaryColor: '#8b5cf6',
      backgroundColor: '#ffffff', textColor: '#1e293b', headingColor: '#0f172a',
      borderColor: '#e2e8f0', accentBackground: '#f8fafc',
      dropCap: false,
      headerStyle: 'minimal-line', pageNumberStyle: 'bottom-center',
      marginsMm: { top: 22, bottom: 24, outer: 18, inner: 16 },
      paragraphSpacing: 0.6,
      headingStyle: 'colored', chapterOpener: 'big', bodyAlign: 'justify'
    },
    minimal: {
      id: 'minimal', label: 'Minimal',
      fontFamily: '"system-ui", -apple-system, sans-serif',
      headingFont: '"system-ui", sans-serif',
      monoFont: '"JetBrains Mono", "Fira Code", monospace',
      baseFontSize: '14px',
      lineHeight: 1.65,
      primaryColor: '#0f172a', secondaryColor: '#475569',
      backgroundColor: '#ffffff', textColor: '#1e293b', headingColor: '#000000',
      borderColor: '#e2e8f0', accentBackground: '#f8fafc',
      dropCap: false,
      headerStyle: 'none', pageNumberStyle: 'bottom-right',
      marginsMm: { top: 26, bottom: 26, outer: 22, inner: 22 },
      paragraphSpacing: 0.65,
      headingStyle: 'rule', chapterOpener: 'plain', bodyAlign: 'left'
    },
    academic: {
      id: 'academic', label: 'Academic',
      fontFamily: '"Times New Roman", Times, "Nimbus Roman No9 L", serif',
      headingFont: '"Times New Roman", Times, serif',
      monoFont: '"Courier New", monospace',
      baseFontSize: '12pt',
      lineHeight: 1.7,
      primaryColor: '#1e3a8a', secondaryColor: '#1e40af',
      backgroundColor: '#ffffff', textColor: '#111827', headingColor: '#0f172a',
      borderColor: '#cbd5e1', accentBackground: '#f1f5f9',
      dropCap: false,
      headerStyle: 'running-chapter', pageNumberStyle: 'top-outside',
      marginsMm: { top: 24, bottom: 26, outer: 20, inner: 16 },
      paragraphSpacing: 0.5,
      headingStyle: 'rule', chapterOpener: 'plain', bodyAlign: 'justify'
    },
    editorial: {
      id: 'editorial', label: 'Editorial',
      fontFamily: '"Georgia", "Cambria", serif',
      headingFont: '"Playfair Display", "Georgia", serif',
      monoFont: '"Courier New", monospace',
      baseFontSize: '15px',
      lineHeight: 1.75,
      primaryColor: '#991b1b', secondaryColor: '#b91c1c',
      backgroundColor: '#fffdfa', textColor: '#292524', headingColor: '#1c1917',
      borderColor: '#e7e5e4', accentBackground: '#f5f5f4',
      dropCap: true,
      headerStyle: 'serif-bar', pageNumberStyle: 'bottom-outside',
      marginsMm: { top: 26, bottom: 30, outer: 20, inner: 16 },
      paragraphSpacing: 0.5,
      headingStyle: 'ornament', chapterOpener: 'ornament', bodyAlign: 'justify'
    },
    luxury: {
      id: 'luxury', label: 'Luxury',
      fontFamily: '"Cormorant Garamond", "Garamond", "Georgia", serif',
      headingFont: '"Cinzel", "Cormorant Garamond", serif',
      monoFont: '"Courier New", monospace',
      baseFontSize: '16px',
      lineHeight: 1.8,
      primaryColor: '#b45309', secondaryColor: '#1e293b',
      backgroundColor: '#faf8f5', textColor: '#262626', headingColor: '#171717',
      borderColor: '#d6d3d1', accentBackground: '#f5f0e8',
      dropCap: true,
      headerStyle: 'gold-ornament', pageNumberStyle: 'bottom-center-ornament',
      marginsMm: { top: 30, bottom: 34, outer: 26, inner: 20 },
      paragraphSpacing: 0.5,
      headingStyle: 'ornament', chapterOpener: 'ornament', bodyAlign: 'justify'
    },
    textbook: {
      id: 'textbook', label: 'Textbook',
      fontFamily: '"Inter", "Segoe UI", sans-serif',
      headingFont: '"Inter", sans-serif',
      monoFont: '"JetBrains Mono", "Fira Code", monospace',
      baseFontSize: '14px',
      lineHeight: 1.6,
      primaryColor: '#0284c7', secondaryColor: '#0369a1',
      backgroundColor: '#ffffff', textColor: '#1e293b', headingColor: '#0c4a6e',
      borderColor: '#bae6fd', accentBackground: '#f0f9ff',
      dropCap: false,
      headerStyle: 'colored-band', pageNumberStyle: 'bottom-outside-badge',
      marginsMm: { top: 22, bottom: 24, outer: 18, inner: 16 },
      paragraphSpacing: 0.6,
      headingStyle: 'colored', chapterOpener: 'big', bodyAlign: 'justify'
    },
    technical: {
      id: 'technical', label: 'Technical',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace, sans-serif',
      headingFont: '"Inter", sans-serif',
      monoFont: '"JetBrains Mono", "Fira Code", monospace',
      baseFontSize: '13.5px',
      lineHeight: 1.55,
      primaryColor: '#0d9488', secondaryColor: '#0f766e',
      backgroundColor: '#ffffff', textColor: '#0f172a', headingColor: '#115e59',
      borderColor: '#ccfbf1', accentBackground: '#f0fdfa',
      dropCap: false,
      headerStyle: 'code-header', pageNumberStyle: 'bottom-right-bracket',
      marginsMm: { top: 20, bottom: 22, outer: 18, inner: 16 },
      paragraphSpacing: 0.55,
      headingStyle: 'inline', chapterOpener: 'plain', bodyAlign: 'left'
    },
    classic: {
      id: 'classic', label: 'Classic',
      fontFamily: '"Garamond", "Georgia", "Baskerville", serif',
      headingFont: '"Garamond", "Georgia", serif',
      monoFont: '"Courier New", monospace',
      baseFontSize: '15px',
      lineHeight: 1.7,
      primaryColor: '#334155', secondaryColor: '#475569',
      backgroundColor: '#ffffff', textColor: '#1e293b', headingColor: '#0f172a',
      borderColor: '#e2e8f0', accentBackground: '#f8fafc',
      dropCap: true,
      headerStyle: 'classic-rule', pageNumberStyle: 'bottom-center',
      marginsMm: { top: 26, bottom: 28, outer: 22, inner: 18 },
      paragraphSpacing: 0.55,
      headingStyle: 'rule', chapterOpener: 'centered', bodyAlign: 'justify'
    },
    selfhelp: {
      id: 'selfhelp', label: 'Self-Help',
      fontFamily: '"Plus Jakarta Sans", "Inter", sans-serif',
      headingFont: '"Plus Jakarta Sans", sans-serif',
      monoFont: '"JetBrains Mono", monospace',
      baseFontSize: '15px',
      lineHeight: 1.65,
      primaryColor: '#ea580c', secondaryColor: '#f97316',
      backgroundColor: '#fffcf7', textColor: '#292524', headingColor: '#9a3412',
      borderColor: '#fed7aa', accentBackground: '#fff7ed',
      dropCap: false,
      headerStyle: 'warm-pill', pageNumberStyle: 'bottom-outside',
      marginsMm: { top: 22, bottom: 24, outer: 18, inner: 16 },
      paragraphSpacing: 0.6,
      headingStyle: 'rule', chapterOpener: 'big', bodyAlign: 'justify'
    }
  };

  /* ------------------------------------------------------------------ *
   *  PAGE SIZE PRESETS (6 exact presets + custom, spec §32)
   * ------------------------------------------------------------------ */
  var PAGE_SIZES = {
    a5: { id: 'a5', label: 'A5 — 148 × 210 mm', widthMm: 148, heightMm: 210, widthIn: 5.83, heightIn: 8.27, cssSize: 'A5' },
    a4: { id: 'a4', label: 'A4 — 210 × 297 mm', widthMm: 210, heightMm: 297, widthIn: 8.27, heightIn: 11.69, cssSize: 'A4' },
    size_5x8: { id: 'size_5x8', label: '5 × 8 in', widthMm: 127, heightMm: 203.2, widthIn: 5.0, heightIn: 8.0, cssSize: '5in 8in' },
    digest_55x85: { id: 'digest_55x85', label: '5.5 × 8.5 in', widthMm: 139.7, heightMm: 215.9, widthIn: 5.5, heightIn: 8.5, cssSize: '5.5in 8.5in' },
    trade_6x9: { id: 'trade_6x9', label: '6 × 9 in', widthMm: 152.4, heightMm: 228.6, widthIn: 6.0, heightIn: 9.0, cssSize: '6in 9in' },
    size_8x10: { id: 'size_8x10', label: '8 × 10 in', widthMm: 203.2, heightMm: 254, widthIn: 8.0, heightIn: 10.0, cssSize: '8in 10in' }
  };

  var FALLBACK_SIZES = {
    letter: { id: 'letter', label: 'US Letter (8.5 × 11 in)', widthMm: 215.9, heightMm: 279.4, widthIn: 8.5, heightIn: 11.0, cssSize: 'letter' }
  };

  var UNITS = ['mm', 'cm', 'inches'];

  var REFERENCE_WIDTH_IN = PAGE_SIZES.trade_6x9.widthIn; // 6
  var REFERENCE_HEIGHT_IN = PAGE_SIZES.trade_6x9.heightIn; // 9

  function roundTo(num, decimals) {
    if (typeof num !== 'number' || isNaN(num)) return 0;
    var factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
  }

  function cleanNum(num, decimals) {
    var rounded = roundTo(num, decimals);
    return Number(rounded.toFixed(decimals));
  }

  function toMm(val, unit) {
    var n = parseFloat(val);
    if (isNaN(n)) return 0;
    if (unit === 'inches' || unit === 'in') return n * 25.4;
    if (unit === 'cm') return n * 10;
    return n; // mm
  }

  function fromMm(mmVal, targetUnit) {
    var n = parseFloat(mmVal);
    if (isNaN(n)) return 0;
    if (targetUnit === 'inches' || targetUnit === 'in') return n / 25.4;
    if (targetUnit === 'cm') return n / 10;
    return n; // mm
  }

  function convertUnit(val, fromUnit, toUnit) {
    if (fromUnit === toUnit) return roundTo(parseFloat(val) || 0, 3);
    var mm = toMm(val, fromUnit);
    var res = fromMm(mm, toUnit);
    if (toUnit === 'inches' || toUnit === 'in') return cleanNum(res, 2);
    if (toUnit === 'cm') return cleanNum(res, 2);
    return cleanNum(res, 1); // mm
  }

  function validateDimensions(w, h, unit) {
    var width = parseFloat(w);
    var height = parseFloat(h);
    if (isNaN(width) || isNaN(height)) {
      return { valid: false, error: 'Width and height must be valid numbers.' };
    }
    if (width <= 0 || height <= 0) {
      return { valid: false, error: 'Width and height must be greater than 0.' };
    }
    var u = (unit === 'in' || unit === 'inches') ? 'inches' : (unit === 'cm' ? 'cm' : 'mm');
    var wMm = toMm(width, u);
    var hMm = toMm(height, u);
    if (wMm > 1000 || hMm > 1000) {
      return { valid: false, error: 'Dimensions exceed maximum allowed limit of 1000 mm (100 cm / 39.4 in).' };
    }
    if (wMm < 20 || hMm < 20) {
      return { valid: false, error: 'Dimensions must be at least 20 mm (2 cm / 0.8 in).' };
    }
    var wIn = cleanNum(wMm / 25.4, 2);
    var hIn = cleanNum(hMm / 25.4, 2);
    var wCm = cleanNum(wMm / 10, 2);
    var hCm = cleanNum(hMm / 10, 2);
    var wMmClean = cleanNum(wMm, 1);
    var hMmClean = cleanNum(hMm, 1);

    return {
      valid: true,
      width: width,
      height: height,
      unit: u,
      widthMm: wMmClean,
      heightMm: hMmClean,
      widthCm: wCm,
      heightCm: hCm,
      widthIn: wIn,
      heightIn: hIn
    };
  }

  function formatDualDimensions(w, h, unit) {
    var val = validateDimensions(w, h, unit);
    if (!val.valid) return { metric: '', imperial: '', label: '' };
    var metric = val.widthMm + ' × ' + val.heightMm + ' mm';
    var imperial = val.widthIn + ' × ' + val.heightIn + ' in';
    return {
      metric: metric,
      imperial: imperial,
      label: metric + ' (' + imperial + ')'
    };
  }

  function createCustomPageSize(input) {
    var u = (input && input.unit) ? input.unit : 'inches';
    var w = input ? (input.width != null ? input.width : input.widthIn) : 6;
    var h = input ? (input.height != null ? input.height : input.heightIn) : 9;
    if (input && (input.widthIn != null || input.heightIn != null) && !input.unit) {
      u = 'inches';
      w = input.widthIn;
      h = input.heightIn;
    }
    var val = validateDimensions(w, h, u);
    if (!val.valid) {
      val = validateDimensions(6, 9, 'inches');
    }
    var label = (input && typeof input.label === 'string' && input.label.trim())
      ? input.label.trim().slice(0, 50)
      : ('Custom ' + val.widthIn + ' × ' + val.heightIn + ' in');
    return {
      id: 'custom',
      label: label,
      widthMm: val.widthMm,
      heightMm: val.heightMm,
      widthCm: val.widthCm,
      heightCm: val.heightCm,
      widthIn: val.widthIn,
      heightIn: val.heightIn,
      unit: val.unit,
      cssSize: val.widthIn + 'in ' + val.heightIn + 'in',
      isCustom: true
    };
  }

  /* ------------------------------------------------------------------ *
   *  STYLE ID MAPS — declarative behaviour for each named style.
   *  (Data, not per-book CSS: the renderer consumes these tokens.)
   * ------------------------------------------------------------------ */
  var HEADER_STYLES = {
    none: { text: false, border: 'none', weight: 600 },
    'minimal-line': { text: true, border: 'bottom', weight: 600, caps: true, spacing: 0.08 },
    'running-chapter': { text: true, border: 'none', weight: 600, caps: false },
    'serif-bar': { text: true, border: 'bottom-double', weight: 700, caps: true, spacing: 0.1 },
    'gold-ornament': { text: true, border: 'ornament', accent: true, weight: 600, caps: true, spacing: 0.18 },
    'colored-band': { text: true, border: 'none', band: true, weight: 700, caps: true, spacing: 0.1 },
    'code-header': { text: true, border: 'bottom-double', mono: true, weight: 600 },
    'classic-rule': { text: true, border: 'bottom', weight: 600, caps: true, spacing: 0.12 },
    'warm-pill': { text: true, border: 'none', pill: true, weight: 600, caps: true },
    'ieee-header': { text: true, border: 'none', weight: 600, caps: true, spacing: 0.05 }
  };

  var PAGE_NUM_STYLES = {
    'bottom-center': { where: 'footer', align: 'center', prefix: '', suffix: '', ornament: false, badge: false },
    'bottom-right': { where: 'footer', align: 'right', prefix: '', suffix: '', ornament: false, badge: false },
    'bottom-outside': { where: 'footer', align: 'right', prefix: '', suffix: '', ornament: false, badge: false },
    'bottom-center-ornament': { where: 'footer', align: 'center', prefix: '', suffix: '', ornament: true, badge: false },
    'bottom-outside-badge': { where: 'footer', align: 'right', prefix: '', suffix: '', ornament: false, badge: true },
    'bottom-right-bracket': { where: 'footer', align: 'right', prefix: '[', suffix: ']', ornament: false, badge: false },
    'top-outside': { where: 'header', align: 'right', prefix: '', suffix: '', ornament: false, badge: false },
    'top-right': { where: 'header', align: 'right', prefix: '', suffix: '', ornament: false, badge: false }
  };

  var OPENER_STYLES = {
    big: { align: 'left', rule: true, size: 1.6, accent: false },
    centered: { align: 'center', rule: true, size: 1.5, accent: false },
    ornament: { align: 'center', rule: 'ornament', size: 1.45, accent: false },
    plain: { align: 'left', rule: false, size: 1.4, accent: false }
  };

  var HEADING_STYLES = {
    colored: { border: false, accent: true, weight: 800, caps: false },
    rule: { border: true, accent: false, weight: 700, caps: false },
    underline: { border: true, accent: true, weight: 700, caps: false },
    ornament: { border: 'ornament', accent: true, weight: 700, caps: false, center: true },
    inline: { border: false, accent: false, weight: 700, caps: true, muted: true }
  };

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */
  function getTheme(id) {
    if (id && THEMES[id]) return THEMES[id];
    return THEMES[DEFAULT_THEME_ID];
  }

  function getPageSize(id, custom) {
    if ((id === 'custom' || !id) && custom) return createCustomPageSize(custom);
    if (id && PAGE_SIZES[id]) return PAGE_SIZES[id];
    if (id && FALLBACK_SIZES[id]) return FALLBACK_SIZES[id];
    return PAGE_SIZES[DEFAULT_PAGE_SIZE_ID];
  }

  function parseSizePx(value) {
    if (value == null) return 13.5;
    var s = String(value).trim();
    var num = parseFloat(s);
    if (isNaN(num)) return 13.5;
    if (/pt\b/i.test(s)) return Math.round(num * (PX_PER_IN / 72) * 100) / 100;
    if (/mm\b/i.test(s)) return Math.round(num / 25.4 * PX_PER_IN * 100) / 100;
    return num; // px or unitless
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Font scale so the SAME theme feels balanced from digest to A4. */
  function fontScaleFor(widthIn) {
    return clamp(widthIn / REFERENCE_WIDTH_IN, 0.85, 1.2);
  }

  /** Size-adjusted base body font (px) for a given physical size. */
  function baseFontPx(theme, widthIn) {
    return Math.round(parseSizePx(theme.baseFontSize) * fontScaleFor(widthIn) * 100) / 100;
  }

  /** Margins auto-adjust with page dimensions (larger page, larger gutters). */
  function autoMarginsMm(theme, widthIn, heightIn) {
    var b = theme.marginsMm || { top: 22, bottom: 24, outer: 18, inner: 16 };
    var sw = clamp(widthIn / REFERENCE_WIDTH_IN, 0.85, 1.35);
    var sh = clamp(heightIn / REFERENCE_HEIGHT_IN, 0.85, 1.25);
    var k = clamp((sw + sh) / 2, 0.86, 1.3);
    var out = {
      top: Math.round(b.top * Math.min(k, 1.12) * 10) / 10,
      bottom: Math.round(b.bottom * Math.min(k, 1.12) * 10) / 10,
      outer: Math.round(b.outer * sw * 1.08 * 10) / 10,
      inner: Math.round(b.inner * sw * 0.95 * 10) / 10
    };
    return out;
  }

  function mmToPx(mm) { return Math.round(mm * PX_PER_IN * IN_PER_MM * 100) / 100; }

  /**
   * Fully resolved page geometry + typography for a (theme, size) pair.
   * themeOrId and sizeOrId may be objects or ids.
   */
  function resolvePageModel(themeOrId, sizeOrId, customSize) {
    var theme = getTheme(themeOrId && themeOrId.id ? themeOrId.id : themeOrId);
    if (sizeOrId && sizeOrId.widthIn && !sizeOrId.id) sizeOrId = Object.assign({ id: 'anon' }, sizeOrId);
    var size = getPageSize((sizeOrId && sizeOrId.id) ? sizeOrId.id : sizeOrId, customSize);
    var w = Math.round(size.widthIn * PX_PER_IN);
    var h = Math.round(size.heightIn * PX_PER_IN);
    var mm = autoMarginsMm(theme, size.widthIn, size.heightIn);
    var mT = mmToPx(mm.top), mB = mmToPx(mm.bottom);
    var mL = mmToPx(mm.inner), mR = mmToPx(mm.outer);
    var headerH = theme.headerStyle === 'none' ? 0 : Math.round(parseSizePx(theme.baseFontSize) * 1.6) + 6;
    var footerH = 22;
    return {
      themeId: theme.id, sizeId: size.id,
      w: w, h: h, mT: mT, mB: mB, mL: mL, mR: mR,
      headerH: headerH, footerH: footerH,
      textW: Math.round(w - mL - mR),
      textH: Math.round(h - mT - mB - headerH - footerH),
      baseFont: baseFontPx(theme, size.widthIn),
      lineHeight: theme.lineHeight,
      mb: Math.round(baseFontPx(theme, size.widthIn) * (theme.paragraphSpacing || 0.6)),
      sizeLabel: size.label,
      widthIn: size.widthIn, heightIn: size.heightIn,
      isCustom: !!size.isCustom,
      theme: theme,
      size: size
    };
  }

  /**
   * Pure pagination: greedily pack items into pages that fit textH.
   * items: [{ key, h }] where h already includes bottom margin.
   * Returns an array of pages, each an array of item keys in order.
   * Deterministic; used by the client preview AND the Node tests so we can
   * prove content integrity across every theme/page-size combination.
   */
  function paginate(items, model) {
    var list = Array.isArray(items) ? items : [];
    var cap = (model && model.textH) ? model.textH : 600;
    var pages = [];
    var current = [];
    var used = 0;
    list.forEach(function (it) {
      var h = (it && it.h) ? it.h : 0;
      if (current.length && used + h > cap) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push(it.key);
      used += h;
      if (used > cap && current.length === 1) {
        // Oversized atomic item: give it its own (clipped) page.
        pages.push(current);
        current = [];
        used = 0;
      }
    });
    if (current.length) pages.push(current);
    return pages;
  }

  /** Content identity helper for tests: ordered keys flattened across pages. */
  function flattenPages(pages) {
    var out = [];
    pages.forEach(function (p) { out = out.concat(p); });
    return out;
  }

  return {
    THEMES: THEMES,
    THEME_IDS: Object.keys(THEMES),
    DEFAULT_THEME_ID: DEFAULT_THEME_ID,
    PAGE_SIZES: PAGE_SIZES,
    PAGE_SIZE_IDS: Object.keys(PAGE_SIZES),
    DEFAULT_PAGE_SIZE_ID: DEFAULT_PAGE_SIZE_ID,
    UNITS: UNITS,
    REFERENCE_WIDTH_IN: REFERENCE_WIDTH_IN,
    REFERENCE_HEIGHT_IN: REFERENCE_HEIGHT_IN,
    HEADER_STYLES: HEADER_STYLES,
    PAGE_NUM_STYLES: PAGE_NUM_STYLES,
    OPENER_STYLES: OPENER_STYLES,
    HEADING_STYLES: HEADING_STYLES,
    getTheme: getTheme,
    getPageSize: getPageSize,
    createCustomPageSize: createCustomPageSize,
    convertUnit: convertUnit,
    validateDimensions: validateDimensions,
    formatDualDimensions: formatDualDimensions,
    toMm: toMm,
    fromMm: fromMm,
    roundTo: roundTo,
    cleanNum: cleanNum,
    parseSizePx: parseSizePx,
    baseFontPx: baseFontPx,
    autoMarginsMm: autoMarginsMm,
    mmToPx: mmToPx,
    resolvePageModel: resolvePageModel,
    paginate: paginate,
    flattenPages: flattenPages
  };
});