# pdf2book — AI Research Paper → Knowledge Book Studio

Local-first backend that ingests research papers, books, and notes; extracts structured
knowledge; detects topics, duplicates, and contradictions; synthesizes a unified outline;
and generates an editable book exportable to Markdown, HTML, and JSON.

## Quick start

```bash
npm install
npm run dev              # http://localhost:3000
```

Open the app, click **⚙ AI settings**, and pick a provider — **OpenCode Zen** (free models)
or **NVIDIA NIM** (free tier). Paste your API key; it is stored only in your browser.

## Architecture

```
PDF/Text → Extraction → Markdown → Chunks → Topics → Dedup → Conflicts
        → Coverage → Outline → Synthesis → Chapters → Exports
```

| Module | Purpose |
| --- | --- |
| `services/pdfExtractor.js` | Per-page text extraction from PDFs |
| `services/markdownConverter.js` | Heading detection → structured markdown |
| `services/chunker.js` | Page → semantic chunks with section provenance |
| `services/topicDetector.js` | Keyword topics + similarity merging |
| `services/duplicateDetector.js` | Semantic duplicate grouping |
| `services/conflictDetector.js` | Contradiction records between sources |
| `services/coverageChecker.js` | "No topic left behind" completeness scores |
| `services/outlineBuilder.js` | Knowledge-driven chapter ordering |
| `services/synthesizer.js` | Knowledge fusion per topic/chapter |
| `services/aiProvider.js` | Pluggable provider (OpenAI or local fallback) |
| `services/storage.js` | Local JSON file store under `data/<project>/` |
| `services/exporter.js` | Markdown / HTML / JSON export |

## API

```
POST   /api/projects                          create project
GET    /api/projects                          list projects
DELETE /api/projects/:id                      delete project

POST   /api/projects/:id/sources              upload PDFs (files) or paste text (text field)
POST   /api/projects/:id/sources/:sid/process extract + chunk a source
GET    /api/projects/:id/sources              list sources

POST   /api/knowledge/:id/analyze             topics, dedup, conflicts, outline, coverage
GET    /api/knowledge/:id/topics|chunks|conflicts|duplicates|coverage

POST   /api/projects/:id/book/generate        synthesize chapters (creates revision)
GET    /api/projects/:id/book                 fetch generated book
PUT    /api/projects/:id/book/chapters/:cid   edit a chapter

GET    /api/projects/:id/export/markdown      download book.md
GET    /api/projects/:id/export/html          download standalone web book
GET    /api/projects/:id/export/json          download full project data

GET    /health                                status + AI provider mode
```

## Development

```bash
npm test     # jest suite (14 tests)
npm run lint # eslint (flat config)
```

## Roadmap

- Phase 2: page-by-page generation, context budgeting, citation styles (APA/IEEE/…)
- Phase 3: visual page editor, templates, fonts, revision compare
- Phase 4: PDF export via pdf-lib, EPUB/DOCX, incremental regeneration
