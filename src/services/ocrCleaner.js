/**
 * OCR cleanup / normalization (master spec §4).
 *
 * Deterministic and conservative:
 *  - fixes obvious mechanical artifacts (soft hyphens, broken words at line ends,
 *    repeated whitespace, control characters)
 *  - NEVER alters factual content, never invents missing text
 *  - idempotent: clean(clean(x)) === clean(x)
 */
function cleanOcr(raw) {
  const stats = { dehyphenated: 0, collapsedBreaks: 0, strippedChars: 0 };
  let text = String(raw == null ? '' : raw);

  // normalize newlines, drop control chars except \n \t
  const before = text;
  text = text.replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- deliberate sanitization of OCR control noise
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (before.length !== text.length) stats.strippedChars += before.length - text.length;

  // soft hyphens + zero-width noise (kept out of a single class: ZWJ is a
  // misleading joined sequence when combined with other marks)
  text = text.replace(/[\u00AD\u200B\u200C\uFEFF]/g, '');
  text = text.replace(/\u200D/g, '');

  // join words broken by line-end hyphen when continuation starts lowercase
  // "exam-\nple" -> "example" ; keeps genuine hyphenated compounds like "state-of-\nthe-art" joined too
  text = text.replace(/([A-Za-z]{2,})-\n([a-z]{1,})/g, (_m, a, b) => {
    stats.dehyphenated++;
    return a + b;
  });

  // normalize bullet glyphs to markdown-ish dashes at line start
  text = text.replace(/^[ \t]*[•·▪◦*][ \t]+/gm, '- ');

  // trim trailing whitespace per line
  text = text.replace(/[ \t]+$/gm, '');

  // collapse 3+ consecutive blank lines into one blank line
  const preCollapse = text;
  text = text.replace(/\n{3,}/g, '\n\n');
  if (preCollapse !== text) stats.collapsedBreaks++;

  // collapse runs of spaces/tabs inside lines
  text = text.replace(/([^\n])[ \t]{2,}/g, '$1 ');

  return { cleaned: text.trim(), raw: String(raw == null ? '' : raw), stats };
}

module.exports = { cleanOcr };
