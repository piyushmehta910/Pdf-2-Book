/**
 * Block-based final-book renderers (master spec §21, §26).
 * Input: assembled book JSON {title, subtitle, author, preface, chapters:[{title,
 * sections:[{title, blocks:[...]}]}], glossary:[{term,definition}], tocEntries, meta}.
 */

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

function blockToMarkdown(b) {
  switch (b.type) {
    case 'paragraph': case 'warning': case 'note':
      return (b.type === 'warning' ? '> **Warning:** ' : b.type === 'note' ? '> ' : '') + b.text;
    case 'summary':
      return `> **Summary:** ${b.text}`;
    case 'definition':
      return `**${b.term}** — ${b.definition}`;
    case 'bullet_list':
      return b.items.map((i) => `- ${i}`).join('\n');
    case 'example':
      return `#### ${b.title || 'Example'}\n\n${b.content}`;
    case 'formula':
      return `\`${b.expression}\`${b.explanation ? ` — ${b.explanation}` : ''}`;
    case 'table': {
      const header = b.headers.length ? `| ${b.headers.join(' | ')} |\n| ${b.headers.map(() => '---').join(' | ')} |` : '';
      const rows = b.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
      return `${header}${rows ? '\n' + rows : ''}`;
    }
    case 'importance':
      return `**[${(b.level || 'medium').toUpperCase()}]** ${b.text}`;
    case 'relationship_map':
      return (b.relationships || []).map((r) => `- **${r.from}** ${r.type || 'related'} **${r.to}**${r.label ? ` (${r.label})` : ''}`).join('\n');
    default:
      return '';
  }
}

function bookToMarkdown(book) {
  const parts = [];
  parts.push(`# ${book.title || 'Untitled'}\n`);
  if (book.subtitle) parts.push(`### ${book.subtitle}\n`);
  if (book.author) parts.push(`*by ${book.author}*\n`);
  if (book.preface) parts.push(`## Preface\n\n${book.preface}\n`);
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  if (chapters.length > 1 && Array.isArray(book.tocEntries)) {
    parts.push('## Contents\n');
    for (const c of chapters) parts.push(`${chapters.indexOf(c) + 1}. ${c.title}`);
    parts.push('');
  }
  for (const [ci, ch] of chapters.entries()) {
    parts.push(`## Chapter ${ci + 1}: ${ch.title}\n`);
    for (const sec of Array.isArray(ch.sections) ? ch.sections : []) {
      parts.push(`### ${sec.title}\n`);
      for (const b of Array.isArray(sec.blocks) ? sec.blocks : []) {
        const md = blockToMarkdown(b);
        if (md) parts.push(md + '\n');
      }
    }
  }
  if (Array.isArray(book.glossary) && book.glossary.length) {
    parts.push('## Glossary\n');
    for (const g of book.glossary) parts.push(`- **${g.term}** — ${g.definition || ''}`);
    parts.push('');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function blockToHtml(b) {
  switch (b.type) {
    case 'paragraph': return `<p>${esc(b.text)}</p>`;
    case 'warning': return `<div class="block warning"><strong>Warning.</strong> ${esc(b.text)}</div>`;
    case 'note': return `<div class="block note">${esc(b.text)}</div>`;
    case 'summary': return `<div class="block summary"><strong>Summary.</strong> ${esc(b.text)}</div>`;
    case 'definition': return `<p><strong>${esc(b.term)}</strong> — ${esc(b.definition)}</p>`;
    case 'bullet_list': return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'example': return `<div class="block example">${b.title ? `<h4>${esc(b.title)}</h4>` : ''}<p>${esc(b.content)}</p></div>`;
    case 'formula': return `<div class="block formula"><code>${esc(b.expression)}</code>${b.explanation ? `<p class="formula-note">${esc(b.explanation)}</p>` : ''}</div>`;
    case 'table':
      return '<table>' +
        (b.headers.length ? `<thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : '') +
        `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'importance':
      return `<div class="block importance"><strong>[${(b.level || 'medium').toUpperCase()}]</strong> ${esc(b.text)}</div>`;
    case 'relationship_map':
      return '<div class="block relationships"><strong>Relationships:</strong><ul>' +
        (b.relationships || []).map((r) => `<li><strong>${esc(r.from)}</strong> ${esc(r.type || 'related')} <strong>${esc(r.to)}</strong>${r.label ? ` (${esc(r.label)})` : ''}</li>`).join('') +
        '</ul></div>';
    default:
      return '';
  }
}

function wikiLinks(html) {
  return html.replace(/\[\[([^\]]+)\]\]/g, (_m, name) => `<a class="wikilink" href="#topic-${slugify(name)}">${esc(name)}</a>`);
}

function bookToHtml(book) {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const body = [];
  body.push(`<header><h1>${esc(book.title || 'Untitled')}</h1>`);
  if (book.subtitle) body.push(`<p class="subtitle">${esc(book.subtitle)}</p>`);
  if (book.author) body.push(`<p class="author">by ${esc(book.author)}</p>`);
  body.push('</header>');
  if (Array.isArray(book.tocEntries) && book.tocEntries.length) {
    body.push('<nav class="toc"><h2>Contents</h2><ol>');
    for (const ch of chapters) body.push(`<li><a href="#${slugify(ch.title)}">${esc(ch.title)}</a></li>`);
    body.push('</ol></nav>');
  }
  if (book.preface) body.push(`<section class="preface"><h2>Preface</h2>${wikiLinks(esc(book.preface)).replace(/\n+/g, '<br>')}</section>`);
  for (const [ci, ch] of chapters.entries()) {
    body.push(`<section class="chapter" id="${slugify(ch.title)}"><h2>Chapter ${ci + 1}: ${esc(ch.title)}</h2>`);
    for (const sec of Array.isArray(ch.sections) ? ch.sections : []) {
      body.push(`<h3 id="${slugify(sec.title)}">${esc(sec.title)}</h3>`);
      for (const b of Array.isArray(sec.blocks) ? sec.blocks : []) {
        const html = blockToHtml(b);
        if (html) body.push(wikiLinks(html));
      }
    }
    body.push('</section>');
  }
  if (Array.isArray(book.glossary) && book.glossary.length) {
    body.push('<section class="glossary"><h2>Glossary</h2><dl>');
    for (const g of book.glossary) body.push(`<dt id="topic-${slugify(g.term)}">${esc(g.term)}</dt><dd>${esc(g.definition || '')}</dd>`);
    body.push('</dl></section>');
  }
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${esc(book.title || 'Book')}</title>\n<style>body{font-family:Georgia,serif;max-width:44em;margin:2em auto;padding:0 1.5em;line-height:1.65;color:#1a1a1a}.subtitle{font-size:1.2em;color:#555}.author{color:#777}.block.warning,.block.note,.block.summary,.block.example,.block.formula{border-left:4px solid #bbb;padding:.5em 1em;margin:1em 0;background:#fafafa}.block.warning{border-color:#c0392b;background:#fdf3f2}.block.summary{border-color:#2980b9;background:#f2f8fd}.wikilink{color:#2980b9;text-decoration:none;border-bottom:1px dotted}table{border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ccc;padding:.35em .6em}code{background:#f4f4f4;padding:.15em .35em;font-size:.95em}</style>\n</head>\n<body>\n${body.join('\n')}\n</body>\n</html>`;
}

function toProjectJson(book, kb) {
  return JSON.stringify({ book, kb }, null, 2);
}

module.exports = { slugify, toMarkdown: bookToMarkdown, toHtml: bookToHtml, toProjectJson };
