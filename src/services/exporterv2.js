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

/** Normalize book metadata from either the `metadata` or `meta` property. */
function bookMetadata(book) {
  return (book && (book.metadata || book.meta)) || {};
}

/** Front matter (title page, copyright, dedication, epigraph) rendered as one HTML string. */
function frontMatterHtml(book) {
  const meta = bookMetadata(book);
  const parts = [];
  const title = book.title || 'Untitled Book';
  const subtitle = book.subtitle || meta.subtitle;
  const author = book.author || meta.author;

  parts.push('<section class="title-page">');
  parts.push(`<h1 class="title-main">${esc(title)}</h1>`);
  if (subtitle) parts.push(`<p class="title-subtitle">${esc(subtitle)}</p>`);
  if (book.byline || author) parts.push(`<p class="title-byline">by ${esc(book.byline || author)}</p>`);
  if (meta.publisher) parts.push(`<p class="title-publisher">${esc(meta.publisher)}</p>`);
  if (meta.place) parts.push(`<p class="title-place">${esc(meta.place)}${meta.year ? `, ${esc(meta.year)}` : ''}</p>`);
  parts.push('</section>');

  const copyrightLine = meta.copyrightLine ||
    `Copyright \u00A9 ${meta.year || new Date().getFullYear()} ${meta.copyrightHolder || author || title}`;
  parts.push('<section class="copyright-page">');
  parts.push(`<p class="copyright-line">${esc(copyrightLine)}</p>`);
  parts.push('<p class="copyright-note">All rights reserved. No part of this publication may be reproduced, stored in a retrieval system, or transmitted in any form or by any means without the prior written permission of the publisher, except in the case of brief quotations for review.</p>');
  if (meta.isbn) parts.push(`<p class="copyright-isbn">ISBN: ${esc(meta.isbn)}</p>`);
  parts.push('</section>');

  if (meta.dedication) {
    parts.push(`<section class="dedication-page"><p>${esc(meta.dedication)}</p></section>`);
  }
  if (meta.epigraph) {
    parts.push(`<section class="epigraph-page"><blockquote><p>${esc(meta.epigraph)}</p></blockquote></section>`);
  }
  return parts.join('\n');
}

/** Enabled front/back matter entries from the new structure engine, else null (legacy book). */
function enabledMatter(book, which) {
  const key = which === 'front' ? 'frontMatter' : 'backMatter';
  return Array.isArray(book && book[key])
    ? book[key].filter((e) => e && e.enabled !== false)
    : null;
}
function findMatter(list, type) {
  if (!list) return null;
  return list.find((e) => e && e.type === type) || null;
}
/** Gate a front/back section by its structure entry; legacy books default on. */
function matterOn(list, type, legacyDefault = true) {
  if (!list) return legacyDefault;
  return findMatter(list, type) !== null;
}

/** Back matter (about the author) rendered as an HTML string, empty when not configured. */
function aboutAuthorHtml(book) {
  const meta = bookMetadata(book);
  if (!meta.aboutAuthor && !meta.authorBio) return '';
  return `<section class="about-author page-break"><h2>About the Author</h2><p>${esc(meta.aboutAuthor || meta.authorBio)}</p></section>`;
}

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
  const meta = bookMetadata(book);
  const citationStyle = meta.citationStyle || 'APA';
  const author = book.author || meta.author;
  const subtitle = book.subtitle || meta.subtitle;

  parts.push('---');
  parts.push(`title: "${book.title || 'Untitled Book'}"`);
  if (subtitle) parts.push(`subtitle: "${subtitle}"`);
  if (author) parts.push(`author: "${author}"`);
  if (meta.publisher) parts.push(`publisher: "${meta.publisher}"`);
  if (meta.year) parts.push(`year: "${meta.year}"`);
  if (meta.isbn) parts.push(`isbn: "${meta.isbn}"`);
  if (meta.bookType) parts.push(`bookType: "${meta.bookType}"`);
  if (meta.designTheme) parts.push(`designTheme: "${meta.designTheme}"`);
  parts.push(`date: "${new Date().toISOString().split('T')[0]}"`);
  parts.push('---\n');

  parts.push(`# ${book.title || 'Untitled Book'}\n`);
  if (subtitle) parts.push(`### ${subtitle}\n`);
  if (book.byline || author) parts.push(`*by ${book.byline || author}*\n`);

  const copyrightLine = meta.copyrightLine ||
    `Copyright \u00A9 ${meta.year || new Date().getFullYear()} ${meta.copyrightHolder || author || book.title || 'the author'}`;
  parts.push(`> ${copyrightLine}\n`);

  if (meta.dedication) parts.push(`### Dedication\n\n> ${meta.dedication}\n`);
  if (meta.epigraph) parts.push(`> "${meta.epigraph}"\n`);
  const fmList = enabledMatter(book, 'front');
  const prefaceEntry = fmList ? findMatter(fmList, 'preface') : null;
  const prefaceText = (prefaceEntry && String(prefaceEntry.content || '').trim()) || book.preface;
  if (prefaceText) parts.push(`## Preface\n\n${prefaceText}\n`);

  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  if (chapters.length > 1) {
    parts.push('## Contents\n');
    for (const [ci, c] of chapters.entries()) {
      parts.push(`${ci + 1}. ${c.title || 'Chapter ' + (ci + 1)}`);
      for (const s of Array.isArray(c.sections) ? c.sections : []) {
        if (s && s.title) parts.push(`    - ${s.title}`);
      }
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
  const bmList = enabledMatter(book, 'back');
  const references = book.references || (book.backMatter && book.backMatter.references) || [];
  if (matterOn(bmList, 'references', true) && Array.isArray(references) && references.length) {
    parts.push('## References\n');
    for (const [idx, r] of references.entries()) {
      parts.push(`${idx + 1}. ${typeof r === 'string' ? r : formatBibliographyEntry(r, citationStyle, idx + 1)}`);
    }
    parts.push('');
  }

  const glossary = book.glossary || (book.backMatter && book.backMatter.glossary) || [];
  if (matterOn(bmList, 'glossary', true) && Array.isArray(glossary) && glossary.length) {
    parts.push('## Glossary\n');
    for (const g of glossary) {
      parts.push(`- **${g.term || ''}** — ${g.definition || ''}`);
    }
    parts.push('');
  }

  const indexEntries = book.index || (book.backMatter && book.backMatter.index) || [];
  if (matterOn(bmList, 'index', true) && Array.isArray(indexEntries) && indexEntries.length) {
    parts.push('## Index\n');
    for (const entry of indexEntries) {
      const term = entry.term || entry.name || '';
      const pages = Array.isArray(entry.pages) ? entry.pages.join(', ') : (entry.pages || '');
      parts.push('- **' + term + '** ' + (pages ? '(' + pages + ')' : ''));
    }
    parts.push('');
  }

  if (meta.aboutAuthor || meta.authorBio) {
    parts.push('## About the Author\n');
    parts.push(meta.aboutAuthor || meta.authorBio);
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
  const tl = require('../../public/themeLayer');
  const model = tl.resolvePageModel(ds, ps);
  const mm = (px) => Math.round((px * 25.4) / 96 * 10) / 10;
  const pns = tl.PAGE_NUM_STYLES[ds.pageNumberStyle] || { where: 'footer', align: 'center', prefix: '', suffix: '', ornament: false, badge: false };
  const hst = tl.HEADER_STYLES[ds.headerStyle] || { text: true, border: 'bottom', weight: 600, caps: true, spacing: 0.08 };
  const open = tl.OPENER_STYLES[ds.chapterOpener] || { align: 'left', rule: false, size: 1.5 };
  const hd = tl.HEADING_STYLES[ds.headingStyle] || { border: false, weight: 700 };
  const numBox = pns.where === 'header' ? (pns.align === 'right' ? '@top-right' : '@top-center') : (pns.align === 'right' ? '@bottom-right' : '@bottom-center');
  const pageNumContent = `'${pns.prefix || ''}' counter(page) '${pns.suffix || ''}'`;

  return `
@page {
  size: ${ps.cssSize || 'A4'};
  margin: ${mm(model.mT)}mm ${mm(model.mR)}mm ${mm(model.mB)}mm ${mm(model.mL)}mm;
  ${numBox} {
    content: ${pageNumContent};
    font-family: ${ds.fontFamily};
    font-size: 9pt;
    color: #64748b;
  }
}

@page :left {
  margin-left: ${mm(model.mL * 1.2)}mm;
  margin-right: ${mm(model.mR * 0.92)}mm;
  ${hst.text === false ? '' : `@top-left {
    content: string(book-title);
    font-family: ${ds.fontFamily};
    font-size: 8.5pt;
    color: #94a3b8;
    text-transform: ${hst.caps ? 'uppercase' : 'none'};
    letter-spacing: ${(hst.spacing || 0.05)}em;
  }`}
}

@page :right {
  margin-left: ${mm(model.mL * 0.92)}mm;
  margin-right: ${mm(model.mR * 1.2)}mm;
  ${hst.text === false ? '' : `@top-right {
    content: string(chapter-title);
    font-family: ${ds.fontFamily};
    font-size: 8.5pt;
    color: #94a3b8;
    text-transform: ${hst.caps ? 'uppercase' : 'none'};
    letter-spacing: ${(hst.spacing || 0.05)}em;
  }`}
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
  color: ${hd.accent ? (ds.primaryColor || '#6366f1') : (hd.muted ? (ds.secondaryColor || '#475569') : (ds.headingColor || '#0f172a'))};
  page-break-after: avoid;
  break-after: avoid;
  ${hd.caps ? 'text-transform: uppercase; letter-spacing: 0.06em;' : ''}
}

h2, h3 {
  ${hd.border ? `border-bottom: ${hd.accent ? '2px' : '1px'} solid ${hd.accent ? (ds.primaryColor || '#6366f1') : (ds.borderColor || '#e2e8f0')}; padding-bottom: 0.25em;` : ''}
  ${hd.ornament === true ? 'text-align: center;' : ''}
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
  font-size: ${open.size}em;
  text-align: ${open.align};
  margin-top: 1.5em;
  margin-bottom: 0.6em;
  ${open.rule === true ? `border-bottom: 2px solid ${ds.borderColor || '#e2e8f0'}; padding-bottom: 0.3em;` : ''}
  ${open.rule === 'ornament' ? 'padding-bottom: 0.3em; border-bottom: 1px solid ' + (ds.borderColor || '#e2e8f0') + ';' : ''}
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

.title-page {
  text-align: center;
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  page-break-after: always;
  break-after: page;
}

.title-main {
  font-family: ${ds.headingFont || ds.fontFamily};
  font-size: 2.8em;
  color: ${ds.headingColor || '#0f172a'};
  margin: 0.4em 0;
}

.title-subtitle {
  font-size: 1.35em;
  color: #64748b;
  font-style: italic;
  margin-bottom: 1.6em;
}

.title-byline {
  font-size: 1.15em;
  font-weight: 600;
  color: ${ds.textColor || '#1e293b'};
}

.title-publisher {
  font-size: 1em;
  color: #64748b;
  margin-top: 3em;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.title-place {
  font-size: 0.95em;
  color: #94a3b8;
}

.copyright-page {
  page-break-after: always;
  break-after: page;
  font-size: 0.82em;
  color: #64748b;
  line-height: 1.6;
  max-width: 34em;
  margin: 0 auto;
}

.copyright-note {
  margin-top: 1.4em;
}

.dedication-page {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 1.25em;
  font-style: italic;
  color: ${ds.headingColor || '#0f172a'};
  page-break-after: always;
  break-after: page;
}

.epigraph-page {
  min-height: 50vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.epigraph-page blockquote {
  max-width: 26em;
  font-style: italic;
  font-size: 1.15em;
  color: #475569;
  border-left: 3px solid ${ds.primaryColor || '#6366f1'};
  padding-left: 1.2em;
  margin: 0;
}

.about-author {
  max-width: 38em;
}
`;
}

function bookToHtml(book, design = 'modern', pageSize = 'trade_6x9') {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const meta = bookMetadata(book);
  const citationStyle = meta.citationStyle || 'APA';
  const designId = meta.designTheme || design || 'modern';
  const sizeId = meta.pageSize || pageSize || 'trade_6x9';

  const body = [];
  const fmList = enabledMatter(book, 'front');
  const bmList = enabledMatter(book, 'back');

  // Front Matter: Cover
  body.push('<div class="book-container">');
  if (matterOn(fmList, 'cover')) {
    body.push('<section class="cover-page">');
    body.push(`<h1 class="cover-title">${esc(book.title || 'Untitled Book')}</h1>`);
    if (book.subtitle || meta.subtitle) body.push(`<p class="cover-subtitle">${esc(book.subtitle || meta.subtitle)}</p>`);
    if (book.author || meta.author) body.push(`<p class="cover-author">by ${esc(book.author || meta.author)}</p>`);
    body.push('</section>');
  }

  // Front Matter: Title page, copyright page, dedication, epigraph
  body.push(frontMatterHtml(book));

  // Preface
  const prefaceEntry = fmList ? findMatter(fmList, 'preface') : null;
  const prefaceText = (prefaceEntry && String(prefaceEntry.content || '').trim()) || book.preface;
  if (prefaceText) {
    body.push(`<section class="preface page-break" id="preface"><h2>Preface</h2><p>${wikiLinks(esc(prefaceText)).replace(/\n+/g, '</p><p>')}</p></section>`);
  }

  // Table of Contents (live from the structure)
  if (matterOn(fmList, 'toc') && chapters.length > 0) {
    body.push('<nav class="toc page-break" id="toc"><h2>Table of Contents</h2><ol>');
    for (const f of fmList || []) {
      if (f.type === 'toc' || f.type === 'cover') continue;
      body.push(`<li class="toc-front"><a href="#${f.type === 'preface' ? 'preface' : slugify(f.title)}"><span>${esc(f.title)}</span></a></li>`);
    }
    for (const [ci, ch] of chapters.entries()) {
      body.push(`<li><a href="#${slugify(ch.title)}"><span>Chapter ${ci + 1}: ${esc(ch.title)}</span></a>`);
      const secs = (Array.isArray(ch.sections) ? ch.sections : []).filter((s) => s && s.title);
      if (secs.length) {
        body.push('<ol class="toc-sections">');
        for (const s of secs) body.push(`<li><a href="#${slugify(s.title)}">${esc(s.title)}</a></li>`);
        body.push('</ol>');
      }
      body.push('</li>');
    }
    for (const b of bmList || []) {
      body.push(`<li class="toc-back"><a href="#${slugify(b.title)}"><span>${esc(b.title)}</span></a></li>`);
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
  if (matterOn(bmList, 'references', true) && Array.isArray(references) && references.length) {
    body.push('<section class="references page-break" id="references"><h2>References</h2><ol class="reference-list">');
    for (const [idx, r] of references.entries()) {
      const formatted = typeof r === 'string' ? r : formatBibliographyEntry(r, citationStyle, idx + 1);
      body.push(`<li>${esc(formatted)}</li>`);
    }
    body.push('</ol></section>');
  }

  // Back Matter: Glossary
  const glossary = book.glossary || (book.backMatter && book.backMatter.glossary) || [];
  if (matterOn(bmList, 'glossary', true) && Array.isArray(glossary) && glossary.length) {
    body.push('<section class="glossary page-break" id="glossary"><h2>Glossary</h2><dl>');
    for (const g of glossary) {
      body.push(`<dt id="topic-${slugify(g.term)}">${esc(g.term)}</dt><dd>${esc(g.definition || '')}</dd>`);
    }
    body.push('</dl></section>');
  }

  // Back Matter: Index
  const indexEntries = book.index || (book.backMatter && book.backMatter.index) || [];
  if (matterOn(bmList, 'index', true) && Array.isArray(indexEntries) && indexEntries.length) {
    body.push('<section class="index-section page-break" id="index"><h2>Index</h2><ul class="index-list">');
    for (const entry of indexEntries) {
      const term = entry.term || entry.name || '';
      const pages = Array.isArray(entry.pages) ? entry.pages.join(', ') : (entry.pages || '');
      body.push(`<li><strong>${esc(term)}</strong> ${pages ? `<span class="index-pages">${esc(pages)}</span>` : ''}</li>`);
    }
    body.push('</ul></section>');
  }

  // Back Matter: About the Author
  const aboutAuthor = aboutAuthorHtml(book);
  if (aboutAuthor) body.push(aboutAuthor);

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
