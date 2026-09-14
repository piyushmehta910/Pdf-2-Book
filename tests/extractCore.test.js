const core = require('../public/extract-core.js');

const ctx = { filename: 'paper.pdf', sourceId: 'src-1', pageNumber: 1 };

/* Build a fake pdf.js text item exactly like getTextContent() yields. */
function item(str, x, y, height, hasEOL, fontName) {
  return {
    str,
    transform: [1, 0, 0, height, x, y],
    width: str.length * 0.5,
    height,
    fontName: fontName || 'g_d0_f1',
    hasEOL: !!hasEOL
  };
}

function line(str, size, opts) {
  return Object.assign({ text: str, top: 100, height: size, x0: 10, xStarts: [], avgSize: size, fontName: 'g_d0_f1' }, opts || {});
}

describe('extract-core', () => {
  describe('groupLines', () => {
    test('groups successive items on a line until hasEOL', () => {
      const items = [
        item('Hello', 10, 100, 12, false),
        item('world', 30, 100, 12, true),
        item('Next', 10, 80, 12, true)
      ];
      const lines = core.groupLines(items);
      expect(lines).toHaveLength(2);
      expect(lines[0].text).toBe('Hello world');
      expect(lines[1].text).toBe('Next');
    });

    test('collapses whitespace and drops empty items', () => {
      const lines = core.groupLines([item('  two   spaces  ', 10, 100, 12, true)]);
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe('two spaces');
    });

    test('tracks font size, top and x-starts for heuristics', () => {
      const lines = core.groupLines([
        item('Head', 10, 100, 18, true, 'Inter-Bold'),
        item('body text wider than the heading line', 10, 80, 11, true)
      ]);
      expect(lines[0].avgSize).toBeCloseTo(18, 5);
      expect(lines[0].fontName).toBe('Inter-Bold');
      expect(lines[1].xStarts).toContain(Math.round(10 / 6) * 6);
    });
  });

  describe('heading heuristic', () => {
    test('font size ratio >= 1.8 maps to level 1', () => {
      const info = core.headingInfo(line('Title', 22), 11);
      expect(info).toEqual({ isHeading: true, level: 1, ratio: 2 });
    });

    test('font size ratio >= 1.35 maps to level 2', () => {
      const info = core.headingInfo(line('Subtitle', 16), 11);
      expect(info.isHeading).toBe(true);
      expect(info.level).toBe(2);
    });

    test('bold text slightly larger than body is a level-3 heading', () => {
      const info = core.headingInfo(line('Bold lead', 13, { fontName: 'X-Bold' }), 11);
      expect(info.isHeading).toBe(true);
      expect(info.level).toBe(3);
    });

    test('body-sized non-bold text is not a heading', () => {
      const info = core.headingInfo(line('Body paragraph', 11), 11);
      expect(info.isHeading).toBe(false);
    });
  });

  describe('classifyLines -> typed units', () => {
    test('produces headings and paragraphs with the unit shape', () => {
      const lines = [
        line('Introduction', 22, { top: 100 }),
        line('This is the first body paragraph.', 11, { top: 130 }),
        line('Spanning two physical lines.', 11, { top: 142 })
      ];
      const units = core.classifyLines(lines, ctx);
      expect(units).toHaveLength(2);
      expect(units[0]).toMatchObject({ sourceId: 'src-1', filename: 'paper.pdf', pageNumber: 1, type: 'heading', headingLevel: 1 });
      expect(units[0].type).toBe('heading');
      expect(units[1].type).toBe('paragraph');
      expect(units[1].text).toBe('This is the first body paragraph. Spanning two physical lines.');
    });
  });

  describe('needsOcr', () => {
    test('flags pages with near-zero extractable text', () => {
      expect(core.needsOcr('tiny')).toBe(true);
      expect(core.needsOcr('1234567890123456789012345678901234567890')).toBe(false);
      expect(core.needsOcr('\n \t ')).toBe(true);
    });
  });

  describe('detectTable', () => {
    test("detects explicit '|'-separated rows", () => {
      const lines = ['a | b | c', 'l | x | y', 'm | n | o', 'p | q | r'].map((t) => line(t, 11));
      const r = core.detectTable(lines);
      expect(r.detected).toBe(true);
      expect(r.barRows).toBeGreaterThanOrEqual(4);
    });

    test('detects a repeating column layout across lines', () => {
      const mk = (xs) => line('', 11, { xStarts: xs });
      const lines = [
        mk([10, 150, 300]),
        mk([10, 150, 300]),
        mk([10, 150, 300]),
        mk([10, 150, 300])
      ];
      const r = core.detectTable(lines);
      expect(r.detected).toBe(true);
      expect(r.columns).toBe(3);
      expect(r.reason).toBe('repeating column layout');
    });

    test('plain prose is not a table', () => {
      const lines = [
        line('Once upon a time there was a very long sentence written in prose.', 11),
        line('The research addresses several different questions in detail.', 11),
        line('Another ordinary paragraph keeps flowing across the page.', 11)
      ];
      const r = core.detectTable(lines);
      expect(r.detected).toBe(false);
    });
  });

  describe('buildPage (PDF page assembly)', () => {
    test('marks captions next to images and keeps unit shape', () => {
      const longBody = 'This is a comprehensive body paragraph. '.repeat(6).trim();
      const lines = [
        line(longBody, 11, { top: 60 }),
        line('Figure 1: A bar chart showing the results.', 11, { top: 400 })
      ];
      const images = [{ y: 300, width: 400, height: 250, placeholder: true }];
      const page = core.buildPage({ filename: 'paper.pdf', sourceId: 'src-1', pageNumber: 3, lines, images });
      const types = page.units.map((u) => u.type);
      expect(types).toContain('paragraph');
      expect(types).toContain('image');
      expect(types).toContain('caption');
      for (const u of page.units) {
        expect(u.sourceId).toBe('src-1');
        expect(u.pageNumber).toBe(3);
        expect(u.filename).toBe('paper.pdf');
      }
      expect(page.imageCount).toBe(1);
      expect(page.flags.ocr).toBe(false);
    });

    test('flags detected tables and adds a review-flagged table unit', () => {
      const lines = [
        line('Col1 | Col2 | Col3', 11),
        line('a | b | c', 11),
        line('d | e | f', 11),
        line('g | h | i', 11)
      ];
      const page = core.buildPage({
        filename: 'paper.pdf', sourceId: 'src-1', pageNumber: 2, lines, images: [],
        table: core.detectTable(lines)
      });
      expect(page.flags.table).toBe(true);
      const tableUnit = page.units.find((u) => u.type === 'table');
      expect(tableUnit).toBeTruthy();
      expect(tableUnit.flagged).toBe(true);
    });

    test('replaces sparse body text with OCR result when OCR succeeded', () => {
      const lines = [line('scan noise #%$', 11, { top: 50 })];
      const page = core.buildPage({
        filename: 'paper.pdf', sourceId: 'src-1', pageNumber: 4, lines, images: [],
        ocrText: 'The actual scanned page containing readable paragraphs.', ocrApplied: true
      });
      expect(page.ocrApplied).toBe(true);
      expect(page.flags.ocr).toBe(true);
      expect(page.units.some((u) => u.ocr === true)).toBe(true);
    });
  });

  describe('docxToPage (mammoth HTML)', () => {
    const html = [
      '<h1>Chapter One</h1>',
      '<p>A <strong>bold piece</strong> and an <em>italic piece</em>.</p>',
      '<p>Second paragraph.</p>',
      '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>',
      '<img width="120" height="80" src="media/image1.png">',
      '<h2>Sub section</h2>'
    ].join('\n');

    test('converts headings, paragraphs, tables and images into typed units', () => {
      const page = core.docxToPage(html, { filename: 'notes.docx', pageNumber: 1 });
      const types = page.units.map((u) => u.type);
      expect(types.filter((t) => t === 'heading')).toHaveLength(2);
      expect(types).toContain('paragraph');
      expect(types).toContain('table');
      expect(types).toContain('image');
      expect(page.flags.table).toBe(true);

      const h1 = page.units.find((u) => u.type === 'heading' && u.headingLevel === 1);
      expect(h1.text).toBe('Chapter One');
      const table = page.units.find((u) => u.type === 'table');
      expect(table.text).toContain('A');
      expect(table.text).toContain('D');
      expect(table.flagged).toBe(true);
    });

    test('preserves basic bold and italic formatting markers', () => {
      const page = core.docxToPage('<p>Some <strong>bold</strong> and <em>italic</em> text.</p>', { filename: 'x.docx', pageNumber: 1 });
      const p = page.units.find((u) => u.type === 'paragraph');
      expect(p.text).toBe('Some **bold** and *italic* text.');
    });
  });

  describe('textPageUnits', () => {
    test('splits plain text into paragraphs on blank lines', () => {
      const units = core.textPageUnits('First paragraph line one.\nline two.\n\nSecond paragraph.', { filename: 'notes.txt', pageNumber: 1 });
      expect(units).toHaveLength(2);
      expect(units[0].text).toBe('First paragraph line one. line two.');
      expect(units[0].type).toBe('paragraph');
    });
  });
});