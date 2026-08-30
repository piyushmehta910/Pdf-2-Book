/**
 * Block-based final-book renderers and publishing exporter (master spec §12, §13, §14, §15, §16, §17, §18, §19, §31, §32).
 * Supports HTML (Standalone & Print PDF @page stylesheet), Markdown (with YAML front matter), DOCX XML package, and JSON.
 */

const { getDesign, getPageSize } = require('./bookPresets');
const { formatInTextCitation, formatBibliographyEntry } = require('./citationFormatter');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

function blockToMarkdown(b, citationStyle = 'APA') {
  if (!b) return '';
  switch (b.type) {
    case 'heading': {
      const hashes = '#'.repeat(Math.min(6, Math.max(1, (b.level || 2) + 1)));
      return `${hashes} ${b.text || ''}\n`;
    }
    case 'paragraph': {
      const cit = b.sourceRef ? ` ${formatInTextCitation(b.sourceRef, citationStyle)}` : '';
      return (b.text || '') + cit;
    }
    case 'warning':
      return `> **Warning:** ${b.text || ''}`;
    case 'note':
      return `> **Note:** ${b.text || ''}`;
    case 'summary':
      return `> **Summary:** ${b.text || ''}`;
    case 'callout': {
      const title = b.title ? `**${b.title}**\n\n` : '';
      return `> ${title}${b.text || ''}`;
    }
    case 'quote': {
      const author = b.author ? `\n> — *${b.author}*` : '';
      return `> "${b.text || ''}"${author}`;
    }
    case 'definition':
      return `**${b.term || 'Term'}** — ${b.definition || ''}`;
    case 'bullet_list':
      return (b.items || []).map((i) => `- ${i}`).join('\n');
    case 'example':
      return `#### ${b.title || 'Example'}\n\n${b.content || ''}`;
    case 'exercise': {
      let out = `#### Exercise: ${b.title || b.question || ''}\n\n${b.content || b.question || ''}`;
      if (b.answer) out += `\n\n*Answer:* ${b.answer}`;
      return out;
    }
    case 'formula':
      return `\`${b.expression || ''}\`${b.explanation ? ` — ${b.explanation}` : ''}`;
    case 'table': {
      const headers = b.headers || [];
      const rows = b.rows || [];
      const header = headers.length ? `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |` : '';
      const body = rows.map((r) => `| ${(Array.isArray(r) ? r : []).join(' | ')} |`).join('\n');
      return `${header}${body ? '\n' + body : ''}`;
    }
    case 'importance':
      return `**[${(b.level || 'medium').toUpperCase()}]** ${b.text || ''}`;
    case 'relationship_map':
      return (b.relationships || []).map((r) => `- **${r.from || ''}** ${r.type || 'related'} **${r.to || ''}**${r.label ? ` (${r.label})` : ''}`).join('\n');
    case 'pageBreak':
      return '\n---\n';
    default:
      return b.text ? String(b.text) : '';
  }
}

function bookToMarkdown(book) {
  const parts = [];
  const meta = book.metadata || book.meta || {};
  const citationStyle = meta.citationStyle || 'APA';

  parts.push('---');
  parts.push(`title: "${book.title || 'Untitled Book'}"`);
  if (book.subtitle) parts.push(`subtitle: "${book.subtitle}"`);
  if (book.author) parts.push(`author: "${book.author}"`);
  if (meta.bookType) parts.push(`bookType: "${meta.bookType}"`);
  if (meta.designTheme) parts.push(`designTheme: "${meta.designTheme}"`);
  parts.push(`date: "${new Date().toISOString().split('T')[0]}"`);
  parts.push('---\n');

  parts.push(`# ${book.title || 'Untitled Book'}\n`);
  if (book.subtitle) parts.push(`### ${book.subtitle}\n`);
  if (book.author) parts.push(`*by ${book.author}*\n`);
  if (book.preface) parts.push(`## Preface\n\n${book.preface}\n`);

  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  if (chapters.length > 1) {
    parts.push('## Contents\n');
    for (const [ci, c] of chapters.entries()) {
      parts.push(`${ci + 1}. ${c.title || 'Chapter ' + (ci + 1)}`);
    }
    parts.push('');
  }

  for (const [ci, ch] of chapters.entries()) {
    parts.push(`## Chapter ${ci + 1}: ${ch.title || 'Untitled Chapter'}\n`);
    if (ch.purpose) parts.push(`*${ch.purpose}*\n`);
    for (const sec of Array.isArray(ch.sections) ? ch.sections : []) {
      if (sec.title) parts.push(`### ${sec.title}\n`);
      for (const b of Array.isArray(sec.blocks) ? sec.blocks : []) {
        const md = blockToMarkdown(b, citationStyle);
        if (md) parts.push(md + '\n');
      }
    }
  }

  // Back Matter
  const references = book.references || (book.backMatter && book.backMatter.references) || [];
  if (Array.isArray(references) && references.length) {
    parts.push('## References\n');
    for (const [idx, r] of references.entries()) {
      parts.push(`${idx + 1}. ${typeof r === 'string' ? r : formatBibliographyEntry(r, citationStyle, idx + 1)}`);
    }
    parts.push('');
  }

  const glossary = book.glossary || (book.backMatter && book.backMatter.glossary) || [];
  if (Array.isArray(glossary) && glossary.length) {
    parts.push('## Glossary\n');
    for (const g of glossary) {
      parts.push(`- **${g.term || ''}** — ${g.definition || ''}`);
    }
    parts.push('');
  }

  const indexEntries = book.index || (book.backMatter && book.backMatter.index) || [];
  if (Array.isArray(indexEntries) && indexEntries.length) {
    parts.push('## Index\n');
    for (const entry of indexEntries) {
      const term = entry.term || entry.name || '';
      const pages = Array.isArray(entry.pages) ? entry.pages.join(', ') : (entry.pages || '');
      parts.push(`- **${term}** ${pages ? `(${pages})` : ''}`);
    }
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function blockToHtml(b, citationStyle = 'APA') {
  if (!b) return '';
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, (b.level || 2) + 1));
      return `<h${lvl} id="${slugify(b.text)}">${esc(b.text)}</h${lvl}>`;
    }
    case 'paragraph': {
      const cit = b.sourceRef ? ` <span class="citation">${esc(formatInTextCitation(b.sourceRef, citationStyle))}</span>` : '';
      return `<p>${esc(b.text)}${cit}</p>`;
    }
    case 'warning':
      return `<div class="block warning"><div class="block-title">Warning</div><p>${esc(b.text)}</p></div>`;
    case 'note':
      return `<div class="block note"><div class="block-title">Note</div><p>${esc(b.text)}</p></div>`;
    case 'summary':
      return `<div class="block summary"><div class="block-title">Summary</div><p>${esc(b.text)}</p></div>`;
    case 'callout': {
      const styleClass = b.style || b.type || 'info';
      return `<div class="block callout ${esc(styleClass)}">${b.title ? `<div class="block-title">${esc(b.title)}</div>` : ''}<p>${esc(b.text)}</p></div>`;
    }
    case 'quote':
      return `<blockquote class="block quote"><p>"${esc(b.text)}"</p>${b.author ? `<cite>— ${esc(b.author)}</cite>` : ''}</blockquote>`;
    case 'definition':
      return `<div class="block definition"><dt><strong>${esc(b.term || '')}</strong></dt><dd>${esc(b.definition || '')}</dd></div>`;
    case 'bullet_list':
      return `<ul>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'example':
      return `<div class="block example">${b.title ? `<h4>${esc(b.title)}</h4>` : ''}<p>${esc(b.content || '')}</p></div>`;
    case 'exercise':
      return `<div class="block exercise"><h4>Exercise: ${esc(b.title || b.question || '')}</h4><p>${esc(b.content || b.question || '')}</p>${b.answer ? `<div class="exercise-answer"><strong>Answer:</strong> ${esc(b.answer)}</div>` : ''}</div>`;
    case 'formula':
      return `<div class="block formula"><code>${esc(b.expression || '')}</code>${b.explanation ? `<p class="formula-note">${esc(b.explanation)}</p>` : ''}</div>`;
    case 'table': {
      const headers = b.headers || [];
      const rows = b.rows || [];
      return '<div class="table-wrap"><table>' +
        (headers.length ? `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : '') +
        `<tbody>${rows.map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    case 'importance':
      return `<div class="block importance level-${(b.level || 'medium').toLowerCase()}"><strong>[${(b.level || 'medium').toUpperCase()}]</strong> ${esc(b.text)}</div>`;
    case 'relationship_map':
      return '<div class="block relationships"><strong>Relationships:</strong><ul>' +
        (b.relationships || []).map((r) => `<li><strong>${esc(r.from || '')}</strong> <span class="rel-type">${esc(r.type || 'related')}</span> <strong>${esc(r.to || '')}</strong>${r.label ? ` (${esc(r.label)})` : ''}</li>`).join('') +
        '</ul></div>';
    case 'pageBreak':
      return '<div class="page-break"></div>';
    default:
      return b.text ? `<p>${esc(b.text)}</p>` : '';
  }
}

function wikiLinks(html) {
  return html.replace(/\[\[([^\]]+)\]\]/g, (_m, name) => `<a class="wikilink" href="#topic-${slugify(name)}">${esc(name)}</a>`);
}

function generatePrintCss(design, pageSize) {
  const ds = getDesign(design);
  const ps = getPageSize(pageSize);

  return `
@page {
  size: ${ps.cssSize || 'A4'};
  margin: 20mm 18mm 24mm 18mm;
  @bottom-center {
    content: counter(page);
    font-family: ${ds.fontFamily};
    font-size: 9pt;
    color: #64748b;
  }
}

@page :left {
  margin-left: 22mm;
  margin-right: 16mm;
  @top-left {
    content: string(book-title);
    font-family: ${ds.fontFamily};
    font-size: 8.5pt;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
}

@page :right {
  margin-left: 16mm;
  margin-right: 22mm;
  @top-right {
    content: string(chapter-title);
    font-family: ${ds.fontFamily};
    font-size: 8.5pt;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
}

body {
  font-family: ${ds.fontFamily};
  font-size: ${ds.baseFontSize || '14.5px'};
  line-height: ${ds.lineHeight || '1.6'};
  color: ${ds.textColor || '#1e293b'};
  background: ${ds.backgroundColor || '#ffffff'};
  margin: 0;
  padding: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.book-container {
  max-width: 48em;
  margin: 0 auto;
  padding: 2.5em 2em;
}

h1, h2, h3, h4, h5, h6 {
  font-family: ${ds.headingFont || ds.fontFamily};
  color: ${ds.headingColor || '#0f172a'};
  page-break-after: avoid;
  break-after: avoid;
}

h1.book-title {
  string-set: book-title content();
  font-size: 2.5em;
  font-weight: 800;
  margin-bottom: 0.2em;
  color: ${ds.primaryColor || '#6366f1'};
}

.chapter-title {
  string-set: chapter-title content();
  page-break-before: always;
  break-before: page;
  font-size: 1.85em;
  margin-top: 1.5em;
  margin-bottom: 0.6em;
  border-bottom: 2px solid ${ds.borderColor || '#e2e8f0'};
  padding-bottom: 0.3em;
}

.chapter-purpose {
  font-style: italic;
  color: #64748b;
  margin-bottom: 1.5em;
  font-size: 0.95em;
}

${ds.dropCap ? `
.chapter > p:first-of-type::first-letter,
.section > p:first-of-type::first-letter {
  font-family: ${ds.headingFont || ds.fontFamily};
  font-size: 3.4em;
  float: left;
  line-height: 0.8;
  margin: 0.1em 0.15em 0 0;
  color: ${ds.primaryColor || '#6366f1'};
}
` : ''}

.block {
  margin: 1.2em 0;
  padding: 0.8em 1.2em;
  border-radius: 6px;
  page-break-inside: avoid;
  break-inside: avoid;
}

.block.warning { border-left: 4px solid #ef4444; background: #fef2f2; color: #991b1b; }
.block.note { border-left: 4px solid ${ds.primaryColor || '#6366f1'}; background: ${ds.accentBackground || '#f8fafc'}; }
.block.summary { border-left: 4px solid #10b981; background: #ecfdf5; color: #065f46; }
.block.callout { border: 1px solid ${ds.borderColor || '#e2e8f0'}; background: ${ds.accentBackground || '#f8fafc'}; }
.block.example { border: 1px solid #bae6fd; background: #f0f9ff; }
.block.exercise { border: 1px solid #fde68a; background: #fffbeb; }
.block.formula { border: 1px solid ${ds.borderColor || '#e2e8f0'}; background: #f8fafc; font-family: monospace; }
.block.definition { border-left: 3px solid ${ds.secondaryColor || '#8b5cf6'}; background: ${ds.accentBackground || '#f8fafc'}; }

blockquote.quote {
  border-left: 4px solid ${ds.primaryColor || '#6366f1'};
  margin: 1.5em 0;
  padding: 0.5em 1.2em;
  font-style: italic;
  color: #475569;
}

blockquote.quote cite {
  display: block;
  font-style: normal;
  font-size: 0.88em;
  color: #64748b;
  margin-top: 0.4em;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.2em 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

th, td {
  border: 1px solid ${ds.borderColor || '#e2e8f0'};
  padding: 0.5em 0.8em;
  text-align: left;
}

th {
  background: ${ds.accentBackground || '#f8fafc'};
  font-weight: 600;
  color: ${ds.headingColor || '#0f172a'};
}

.citation {
  font-size: 0.85em;
  color: ${ds.primaryColor || '#6366f1'};
  font-weight: 500;
}

.wikilink {
  color: ${ds.primaryColor || '#6366f1'};
  text-decoration: underline dotted;
}

.page-break {
  page-break-before: always;
  break-before: page;
}

nav.toc ol {
  list-style: none;
  padding-left: 0;
}

nav.toc li {
  margin: 0.5em 0;
  border-bottom: 1px dotted ${ds.borderColor || '#e2e8f0'};
  display: flex;
  justify-content: space-between;
}

nav.toc a {
  color: inherit;
  text-decoration: none;
}

.cover-page {
  text-align: center;
  padding: 4em 1em;
  page-break-after: always;
  break-after: page;
}

.cover-title {
  font-size: 3em;
  font-weight: 900;
  color: ${ds.primaryColor || '#6366f1'};
  margin-bottom: 0.2em;
}

.cover-subtitle {
  font-size: 1.4em;
  color: #64748b;
  margin-bottom: 2em;
}

.cover-author {
  font-size: 1.2em;
  font-weight: 600;
  color: ${ds.textColor || '#1e293b'};
}
`;
}

function bookToHtml(book, design = 'modern', pageSize = 'trade_6x9') {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const meta = book.metadata || book.meta || {};
  const citationStyle = meta.citationStyle || 'APA';
  const designId = meta.designTheme || design || 'modern';
  const sizeId = meta.pageSize || pageSize || 'trade_6x9';

  const body = [];

  // Front Matter: Cover
  body.push('<div class="book-container">');
  body.push('<section class="cover-page">');
  body.push(`<h1 class="cover-title">${esc(book.title || 'Untitled Book')}</h1>`);
  if (book.subtitle) body.push(`<p class="cover-subtitle">${esc(book.subtitle)}</p>`);
  if (book.author) body.push(`<p class="cover-author">by ${esc(book.author)}</p>`);
  body.push('</section>');

  // Preface
  if (book.preface) {
    body.push(`<section class="preface page-break"><h2>Preface</h2><p>${wikiLinks(esc(book.preface)).replace(/\n+/g, '</p><p>')}</p></section>`);
  }

  // Table of Contents
  if (chapters.length > 0) {
    body.push('<nav class="toc page-break"><h2>Table of Contents</h2><ol>');
    for (const [ci, ch] of chapters.entries()) {
      body.push(`<li><a href="#${slugify(ch.title)}"><span>Chapter ${ci + 1}: ${esc(ch.title)}</span></a></li>`);
    }
    body.push('</ol></nav>');
  }

  // Chapters
  for (const [ci, ch] of chapters.entries()) {
    body.push(`<section class="chapter" id="${slugify(ch.title)}">`);
    body.push(`<h2 class="chapter-title">Chapter ${ci + 1}: ${esc(ch.title)}</h2>`);
    if (ch.purpose) body.push(`<p class="chapter-purpose">${esc(ch.purpose)}</p>`);

    for (const sec of Array.isArray(ch.sections) ? ch.sections : []) {
      body.push(`<div class="section" id="${slugify(sec.title)}">`);
      if (sec.title) body.push(`<h3>${esc(sec.title)}</h3>`);
      for (const b of Array.isArray(sec.blocks) ? sec.blocks : []) {
        const html = blockToHtml(b, citationStyle);
        if (html) body.push(wikiLinks(html));
      }
      body.push('</div>');
    }
    body.push('</section>');
  }

  // Back Matter: References
  const references = book.references || (book.backMatter && book.backMatter.references) || [];
  if (Array.isArray(references) && references.length) {
    body.push('<section class="references page-break"><h2>References</h2><ol class="reference-list">');
    for (const [idx, r] of references.entries()) {
      const formatted = typeof r === 'string' ? r : formatBibliographyEntry(r, citationStyle, idx + 1);
      body.push(`<li>${esc(formatted)}</li>`);
    }
    body.push('</ol></section>');
  }

  // Back Matter: Glossary
  const glossary = book.glossary || (book.backMatter && book.backMatter.glossary) || [];
  if (Array.isArray(glossary) && glossary.length) {
    body.push('<section class="glossary page-break"><h2>Glossary</h2><dl>');
    for (const g of glossary) {
      body.push(`<dt id="topic-${slugify(g.term)}">${esc(g.term)}</dt><dd>${esc(g.definition || '')}</dd>`);
    }
    body.push('</dl></section>');
  }

  // Back Matter: Index
  const indexEntries = book.index || (book.backMatter && book.backMatter.index) || [];
  if (Array.isArray(indexEntries) && indexEntries.length) {
    body.push('<section class="index-section page-break"><h2>Index</h2><ul class="index-list">');
    for (const entry of indexEntries) {
      const term = entry.term || entry.name || '';
      const pages = Array.isArray(entry.pages) ? entry.pages.join(', ') : (entry.pages || '');
      body.push(`<li><strong>${esc(term)}</strong> ${pages ? `<span class="index-pages">${esc(pages)}</span>` : ''}</li>`);
    }
    body.push('</ul></section>');
  }

  body.push('</div>'); // book-container

  const css = generatePrintCss(designId, sizeId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(book.title || 'Book')}</title>
<style>${css}</style>
</head>
<body>
${body.join('\n')}
</body>
</html>`;
}

function toProjectJson(book, kb) {
  return JSON.stringify({ book, kb }, null, 2);
}

module.exports = {
  slugify,
  toMarkdown: bookToMarkdown,
  toHtml: bookToHtml,
  toProjectJson,
  generatePrintCss
};
