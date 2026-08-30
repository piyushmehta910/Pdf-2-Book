# pdf2book — Browser-Based AI Book Creation Studio & Publishing Software

A production-grade, browser-based **AI Book Creation Studio and Publishing Engine** that transforms research papers, PDFs, DOCX, Markdown, and notes into professionally structured, designed, and paginated books.

---

## 🌟 Key Features

- **Multi-Source Library**: Drag-and-drop ingestion for multiple PDFs, Word documents (.docx via client-side XML parser), Markdown files (.md), TXT files, and raw notes with word counts and page tracking.
- **15 Book Presets**: Academic Book, Textbook, Research Book, Technical Book, Self-Help, Business Book, Biography, Novel, Practical Guide, Instruction Manual, Study Notes, Course Book, Children's Book, Reference Manual, Comprehensive Report, and Custom Book.
- **10 Visual Design Themes**: Modern, Minimal, Academic, Editorial, Luxury, Textbook, Technical, Classic, Self-Help, and Research.
- **5 Physical Page Sizes**: Trade 6 × 9 in, A4 (210 × 297 mm), A5 (148 × 210 mm), US Letter (8.5 × 11 in), and Digest 5.5 × 8.5 in.
- **WYSIWYG Paginated Sheet View**: Real-time 2D physical sheet rendering with true margins, running headers (book title / chapter title), running footers (page counters), and interactive block controls.
- **Section-Level AI Rewriter**: Instant AI actions ([Polish Flow], [Expand], [Condense], [Simplify], [Academic Rewrite], [Add Examples], [Add Exercises], [Add Summary], [Add Key Takeaways]) and custom directives.
- **Full Source Traceability**: Every claim carries source provenance (`{ document_id, page, excerpt }`). Clicking any block inspects the cited source in the Inspector.
- **Semantic Source Search**: Ask natural language questions across all uploaded source files with instant grounded answers and page citations.
- **Citation & Bibliography Engine**: Formats citations and auto-generates bibliographies in **APA 7th, MLA 9th, Chicago, IEEE numbered `[1]`, and Vancouver** styles.
- **Quality Audit Engine**: Calculates an automatic 0–100 Quality Score, detecting empty sections, broken cross-references, orphan headings, and unresolved contradictions.
- **Multi-Format Export Engine**: Print-Ready PDF (`@page` CSS paged media layout), Standalone Web HTML, Markdown with YAML front matter, DOCX Word Document, and JSON project backup.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run the development server
npm run dev

# Open in browser: http://localhost:3000
```

1. Open the app in your browser (`http://localhost:3000`).
2. Click **⚙ AI settings** to configure your preferred AI provider (**OpenCode Zen**, **NVIDIA NIM**, **OpenAI**, **Anthropic**, **Gemini**, or **Local Ollama**).
3. Drop your source PDFs, Word documents, or notes into the **Sources** tab.
4. Click **✨ Write Book** to generate structured chapters and inspect them in the **Paginated Pages** studio.

---

## 🏛 Architecture

```
[Sources: PDF/DOCX/MD/TXT] ──► [Client Extraction (PDF.js, JSZip, Tesseract)]
                           ──► [Knowledge Base & Entity Graph]
                           ──► [Semantic Resolver & Contradiction Engine]
                           ──► [Book Planner: 15 Book Presets]
                           ──► [WYSIWYG Paginated Studio: 10 Design Themes + 5 Page Sizes]
                           ──► [AI Rewriter & Citation Engine]
                           ──► [Quality Gate: 0-100 Score Audit]
                           ──► [Publishing Exporter: Print PDF / HTML / MD / DOCX / JSON]
```

---

## 🧪 Testing & Linting

```bash
# Run unit test suite (14 suites, 118 tests)
npm test

# Run ESLint validation
npm run lint
```

---

## 📄 License

MIT License. Built for rigorous research synthesis and professional publishing.
