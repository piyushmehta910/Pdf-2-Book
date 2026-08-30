/**
 * CitationFormatter — Standard citation and bibliography formatting engine.
 * Supports APA, MLA, Chicago, IEEE, Vancouver, and Custom formats.
 */

function formatInTextCitation(ref, style = 'APA', index = 1) {
  if (!ref) return '';
  const author = ref.author || ref.file_name || ref.document_id || 'Source';
  const year = ref.year || ref.date || new Date().getFullYear();
  const page = ref.page ? `, p. ${ref.page}` : '';

  switch ((style || 'APA').toUpperCase()) {
    case 'IEEE':
    case 'VANCOUVER':
      return `[${index}]`;
    case 'MLA':
      return `(${author}${ref.page ? ` ${ref.page}` : ''})`;
    case 'CHICAGO':
      return `(${author} ${year}${page})`;
    case 'APA':
    default:
      return `(${author}, ${year}${page})`;
  }
}

function formatBibliographyEntry(source, style = 'APA', index = 1) {
  const author = source.author || source.creator || 'Unknown Author';
  const title = source.title || source.name || source.file_name || 'Untitled Document';
  const year = source.year || source.date || new Date().getFullYear();
  const publisher = source.publisher || source.organization || '';
  const pages = source.pageCount ? `${source.pageCount} pp.` : '';

  switch ((style || 'APA').toUpperCase()) {
    case 'IEEE':
      return `[${index}] ${author}, "${title}," ${publisher ? publisher + ', ' : ''}${year}.`;
    case 'VANCOUVER':
      return `${index}. ${author}. ${title}. ${publisher ? publisher + '; ' : ''}${year}.`;
    case 'MLA':
      return `${author}. *${title}*. ${publisher ? publisher + ', ' : ''}${year}.`;
    case 'CHICAGO':
      return `${author}. *${title}*. ${publisher ? publisher + ', ' : ''}${year}.`;
    case 'APA':
    default:
      return `${author} (${year}). *${title}*${publisher ? `. ${publisher}` : ''}${pages ? `. (${pages})` : ''}.`;
  }
}

function buildReferenceList(sources = [], style = 'APA') {
  if (!Array.isArray(sources) || !sources.length) return [];
  return sources.map((src, idx) => ({
    id: src.id || `ref-${idx + 1}`,
    index: idx + 1,
    sourceId: src.id,
    citationKey: src.citationKey || `src-${idx + 1}`,
    formatted: formatBibliographyEntry(src, style, idx + 1),
    raw: src
  }));
}

module.exports = {
  formatInTextCitation,
  formatBibliographyEntry,
  buildReferenceList
};
