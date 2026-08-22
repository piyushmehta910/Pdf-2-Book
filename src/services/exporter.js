const fs = require('fs');
const path = require('path');

function toMarkdown(project, chapters) {
  const parts = [];
  parts.push(`# ${project.title || 'Untitled Book'}\n`);
  if (project.author) parts.push(`*by ${project.author}*\n`);
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

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const listItem = line.match(/^\s*[-*]\s+(.*)$/);
    if (heading) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`);
    } else if (listItem) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(listItem[1])}</li>`);
    } else if (!line.trim()) {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function toHtml(project, chapters) {
  const body = chapters
    .map((c) => `<section>${markdownToHtml(c.content)}</section>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(project.title || 'Untitled Book')}</title>
<style>
body { font-family: Georgia, serif; max-width: 42rem; margin: 0 auto; padding: 2rem; line-height: 1.7; color: #222; }
h1, h2, h3 { line-height: 1.3; }
section { margin-bottom: 4rem; }
</style>
</head>
<body>
<h1>${escapeHtml(project.title || 'Untitled Book')}</h1>
${project.author ? `<p><em>${escapeHtml(project.author)}</em></p>` : ''}
${body}
</body>
</html>`;
}

function writeExport(projectId, filename, content) {
  const dir = path.resolve(process.env.DATA_DIR || './data', projectId, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

module.exports = { toMarkdown, toHtml, toProjectJson, markdownToHtml, writeExport };

function toProjectJson(project, bundles) {
  return JSON.stringify({ project, ...bundles }, null, 2);
}
