function isLikelyHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (/^\d+(\.\d+)*\.?\s+\S/.test(trimmed)) return true;
  if (/^[A-Z][^.!?]{5,90}$/.test(trimmed) && trimmed === trimmed.replace(/[a-z]{12,}/, (m) => (m.length > 0 ? trimmed : '')) && trimmed.toUpperCase() === trimmed && trimmed.length > 3) return true;
  const words = trimmed.split(/\s+/);
  if (words.length <= 12 && /^[A-Z]/.test(trimmed) && !/[.,;]$/.test(trimmed)) {
    const known = /^(abstract|introduction|background|related work|methods?|methodology|materials and methods|results?|discussion|conclusions?|references|acknowledg(e)?ments?|summary|appendix|keywords?)/i;
    if (known.test(trimmed)) return true;
  }
  return false;
}

function headingLevel(line) {
  const match = line.trim().match(/^(\d+(?:\.\d+)*)\.?\s/);
  if (match) {
    const depth = match[1].split('.').length;
    return Math.min(depth + 1, 4);
  }
  return 2;
}

function pageToMarkdown(pageText, pageNumber) {
  const lines = String(pageText || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out = [`<!-- page ${pageNumber} -->`, ''];
  for (const line of lines) {
    if (isLikelyHeading(line)) {
      const level = headingLevel(line);
      const clean = line.replace(/^\d+(\.\d+)*\.?\s+/, '');
      out.push(`${'#'.repeat(level)} ${clean}`, '');
    } else {
      out.push(line, '');
    }
  }
  return out.join('\n');
}

function documentToMarkdown(pages) {
  const parts = pages.map((p) => pageToMarkdown(p.text, p.pageNumber));
  return parts.join('\n\n');
}

module.exports = { pageToMarkdown, documentToMarkdown, isLikelyHeading, headingLevel };
