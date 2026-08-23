const fs = require('fs');
const path = require('path');
const { slugify } = require('./chapterComposer');

function toMarkdown(project, chapters) {
  const parts = [];
  parts.push(`# ${project.title || 'Untitled Book'}\n`);
  if (project.author) parts.push(`*by ${project.author}*\n`);
  const tocLines = chapters
    .filter((c) => c.type !== 'appendix')
    .map((c, i) => `${i + 1}. ${c.title}`);
  if (tocLines.length > 1) parts.push(`## Contents\n\n${tocLines.join('\n')}\n`);
  for (const chapter of chapters) {
    parts.push(chapter.content);
    parts.push('');
  }
  return parts.join('\n');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderWikiLinks(html) {
  return html.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
    return `<a class="wikilink" href="#${slugify(name)}">${escapeHtml(name)}</a>`;
  });
}

function markdownToHtml(markdown, { wikiLinks = false } = {}) {
  const lines = String(markdown).split(/\r?\n/);
  const out = [];
  let inList = false;
  let listStack = 0;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const indentMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    const indent = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
    let text = indentMatch ? indentMatch[2] : '';
    if (wikiLinks) {
      if (heading) heading[2] = renderWikiLinks(escapeHtml(heading[2]));
      else text = renderWikiLinks(escapeHtml(text));
    } else if (heading) {
      heading[2] = escapeHtml(heading[2]);
    } else {
      text = escapeHtml(text);
    }
    if (heading) {
      while (listStack > 0) { out.push('</ul>'); listStack--; }
      inList = false;
      const id = slugify(heading[2].replace(/<[^>]+>/g, ''));
      out.push(`<h${heading[1].length} id="${id}">${heading[2]}</h${heading[1].length}>`);
    } else if (indentMatch) {
      while (listStack > indent + 1) { out.push('</ul>'); listStack--; }
      while (listStack < indent + 1) { out.push('<ul>'); listStack++; }
      inList = true;
      out.push(`<li>${text}</li>`);
    } else if (!line.trim()) {
      // keep open lists across blank lines inside a block
    } else {
      while (listStack > 0) { out.push('</ul>'); listStack--; }
      inList = false;
      const processed = wikiLinks ? renderWikiLinks(escapeHtml(line)) : escapeHtml(line);
      out.push(`<p>${processed}</p>`);
    }
  }
  while (listStack > 0) { out.push('</ul>'); listStack--; }
  void inList;
  return out.join('\n');
}

function flashcardsHtml(chapter) {
  return (chapter.cards || []).map((card, i) =>
    `<div class="fcard"><div class="fq">Q${i + 1}. ${renderWikiLinks(escapeHtml(card.front))}</div><div class="fa">${renderWikiLinks(escapeHtml(card.back))}</div></div>`
  ).join('\n');
}

function toHtml(project, chapters, notebook = {}) {
  const isFlashcards = notebook.format === 'flashcards';
  const body = chapters.map((c) => {
    const inner = c.type === 'appendix'
      ? markdownToHtml(c.content, { wikiLinks: notebook.format === 'wiki' })
      : isFlashcards && c.cards && c.cards.length
        ? `<h2>${escapeHtml(c.title)}</h2>\n${flashcardsHtml(c)}`
        : markdownToHtml(c.content.replace(/^#[^\n]*\n+/, ''), { wikiLinks: notebook.format === 'wiki' });
    return `<section id="ch-${slugify(c.title)}" class="${c.type || 'chapter'}">${inner}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(project.title || 'Untitled Book')}</title>
<style>
body { font-family: Georgia, serif; max-width: 44rem; margin: 0 auto; padding: 2rem; line-height: 1.7; color: #222; }
h1, h2, h3 { line-height: 1.3; }
section { margin-bottom: 4rem; }
section.appendix { border-top: 2px solid #ccc; padding-top: 2rem; color: #555; font-size: .95em; }
.wikilink { color: #4a5bd6; text-decoration: none; border-bottom: 1px dotted #4a5bd6; }
.fcard { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; background: #fafaff; }
.fq { font-weight: bold; margin-bottom: .5rem; }
.fa { white-space: pre-line; }
</style>
</head>
<body>
<h1>${escapeHtml(project.title || 'Untitled Book')}</h1>
${project.author ? `<p><em>${escapeHtml(project.author)}</em></p>` : ''}
${body}
</body>
</html>`;
}

function csvEscape(value) {
  const v = String(value).replace(/\r?\n/g, ' ');
  return `"${v.replace(/"/g, '""')}"`;
}

function toFlashcardsCsv(chapters) {
  const rows = [];
  for (const chapter of chapters) {
    for (const card of chapter.cards || []) {
      rows.push([csvEscape(card.front), csvEscape(card.back), csvEscape(chapter.title)].join(','));
    }
  }
  if (!rows.length) return null;
  return 'Front,Back,Chapter\n' + rows.join('\n') + '\n';
}

function writeExport(projectId, filename, content) {
  const dir = path.resolve(process.env.DATA_DIR || './data', projectId, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

module.exports = { toMarkdown, toHtml, toProjectJson, toFlashcardsCsv, markdownToHtml, writeExport };

function toProjectJson(project, bundles) {
  return JSON.stringify({ project, ...bundles }, null, 2);
}
