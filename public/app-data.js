/**
 * pdf2book local-first data layer.
 *
 * Owns ALL client persistence:
 *   - Dexie (IndexedDB) stores projects, sources (raw blobs), extracted text,
 *     the book structure tree, settings/theme, and a version history log.
 *   - A Zustand store (vanilla, no React) holds the in-memory state and is
 *     synced back to Dexie via a debounced autosave.
 *
 * Loads as a browser global (`window.pdf2bookData`) or as a CommonJS module
 * (used by tests with fake-indexeddb). The UI layer hooks in via setHooks().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const zustandModule = require('zustand/vanilla');
    const storeFactory = zustandModule.createStore || zustandModule;
    module.exports = factory(root, require('dexie'), storeFactory);
  } else {
    root.pdf2bookData = factory(root, root.LocalFirst.Dexie, root.LocalFirst.createStore);
  }
})(typeof self !== 'undefined' ? self : this, function (root, Dexie, createStore) {
  'use strict';

  const DB_NAME = 'pdf2book';
  const HISTORY_CAP = 100;

  /* ------------------------------------------------------------------ *
   *  Schema
   * ------------------------------------------------------------------ */
  const db = new Dexie(DB_NAME);
  db.version(1).stores({
    projects:  'id, title, updatedAt, createdAt',        // project metadata
    sources:   'id, projectId, name, status, addedAt, updatedAt', // raw file + meta
    extracted: 'id, projectId, sourceId, updatedAt',     // extracted text per source
    books:     'projectId',                              // full book structure tree
    settings:  'id, updatedAt',                          // theme / editor settings
    history:   '++id, projectId, timestamp'              // version history log (insertion order = auto key)
  });

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */
  function uid(prefix) {
    const rnd = (root.crypto && typeof root.crypto.randomUUID === 'function')
      ? root.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    return (prefix || 'id') + '_' + rnd;
  }

  function nowIso() { return new Date().toISOString(); }

  function isSecondary(b) {
    return typeof Blob !== 'undefined' && Blob && b instanceof Blob
      || typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer
      || typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(b);
  }

  /** Deep-copy a value/row, turning binary values into base64 placeholders for JSON backups. */
  function serializeValue(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (isSecondary(v)) {
      if (typeof Blob !== 'undefined' && v instanceof Blob) {
        return { __p2b_blob__: { type: v.type || '', size: v.size, data: blobToBase64(v) } };
      }
      const bytes = ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v);
      return { __p2b_bin__: { type: 'bytes', data: bytesToBase64(bytes) } };
    }
    if (Array.isArray(v)) return v.map(serializeValue);
    if (typeof v === 'object') {
      const out = {};
      for (const key of Object.keys(v)) out[key] = serializeValue(v[key]);
      return out;
    }
    return v;
  }

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === 'string') {
          const idx = res.indexOf(',');
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        } else {
          resolve(bytesToBase64(new Uint8Array(res)));
        }
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Zustand store (in-memory state)
   * ------------------------------------------------------------------ */
  const store = createStore((set) => ({
    ready: false,
    activeProjectId: null,
    projects: [],            // project metadata for the dashboard
    workspace: null,         // the loaded book (ws) object; sources live on it
    settings: {},            // theme + editor settings
    lastSavedAt: null,
    _actions: {
      setReady: (v) => set({ ready: v }),
      setProjects: (projects) => set({ projects }),
      setWorkspace: (workspace) => set({ workspace }),
      setSettings: (settings) => set({ settings }),
      markSaved: (ts) => set({ lastSavedAt: ts })
    }
  }));

  /* ------------------------------------------------------------------ *
   *  UI hooks (wired by the app, no-ops in tests)
   * ------------------------------------------------------------------ */
  const hooks = {
    onProjectsChanged: null,   // (projects) => void
    onWorkspaceLoaded: null,   // (workspace, sources) => void
    onSaveStatus: null,        // (state: 'idle'|'saving'|'saved'|'error', ts) => void
    onSourcesChanged: null     // (sources) => void
  };

  function setHooks(h) {
    Object.assign(hooks, h || {});
  }

  /* ------------------------------------------------------------------ *
   *  Settings
   * ------------------------------------------------------------------ */
  const DEFAULT_SETTINGS = {
    theme: 'dark',
    citationStyle: 'APA',
    provider: 'zen',
    model: '',
    apiKey: '',
    activeProject: null
  };

  async function readSettings() {
    const rows = await db.settings.toArray();
    const out = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row && row.id) out[row.id] = row.value;
    }
    return out;
  }

  async function writeSettings(settings) {
    const ts = nowIso();
    await db.transaction('rw', db.settings, async () => {
      for (const key of Object.keys(settings)) {
        if (settings[key] !== undefined) await db.settings.put({ id: key, value: settings[key], updatedAt: ts });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  History log
   * ------------------------------------------------------------------ */
  async function logHistory(projectId, message) {
    const ts = nowIso();
    await db.history.add({ projectId, timestamp: ts, message });
    await pruneHistory(projectId);
  }

  async function pruneHistory(projectId) {
    const keepIds = await db.history
      .where('projectId').equals(projectId)
      .reverse().limit(HISTORY_CAP).primaryKeys();
    await db.history
      .where('projectId').equals(projectId)
      .and((h) => !keepIds.includes(h.id)).delete();
  }

  /* ------------------------------------------------------------------ *
   *  Books (structure tree) rows: strip heavy per-source text
   * ------------------------------------------------------------------ */
  function workspaceRow(ws) {
    if (!ws) return {};
    const { sources, ...rest } = ws;
    return { ...rest, sourcesMeta: (sources || []).map((s) => ({
      id: s.id, name: s.name, size: s.size, type: s.type, status: s.status, pageCount: s.pageCount, wordCount: s.wordCount
    })) };
  }

  /* ------------------------------------------------------------------ *
   *  Project CRUD
   * ------------------------------------------------------------------ */
  const DEFAULT_SHELL = (title) => ({
    title: title || 'Untitled Research Book',
    bookType: 'textbook',
    design: 'modern',
    pageSize: 'trade_6x9',
    dimensions: { widthMm: 152.4, heightMm: 228.6, widthIn: 6.0, heightIn: 9.0, unit: 'inches', label: '6 × 9 in' },
    customSize: null,
    citationStyle: 'APA',
    meta: {},
    sources: [],
    kb: { topics: [], conflicts: [], unresolved_refs: [], glossary: {} },
    frontMatter: [],
    backMatter: [],
    structureApproved: false,
    chapters: [
      {
        id: uid('ch'),
        title: 'Foundations',
        purpose: 'Core background principles and foundational concepts.',
        sections: [
          {
            id: uid('sec'),
            title: 'Introduction',
            blocks: [
              {
                type: 'paragraph',
                text: 'pdf2book automatically ingests your source PDFs and notes, maps the knowledge inside, and writes coherent, professionally formatted chapters with full source traceability.',
                sourceRef: { document_id: 'sample-doc', page: 1 }
              }
            ]
          }
        ]
      }
    ],
    qa: { score: 98, status: 'pass', warnings: [], errors: [] }
  });

  async function listProjects() {
    const projects = await db.projects.orderBy('updatedAt').reverse().toArray();
    store.getState()._actions.setProjects(projects);
    if (hooks.onProjectsChanged) hooks.onProjectsChanged(projects);
    return projects;
  }

  async function createProject(title) {
    const ts = nowIso();
    const id = uid('proj');
    const shell = DEFAULT_SHELL(title);
    await db.transaction('rw', db.projects, db.books, db.history, async () => {
      await db.projects.put({ id, title: shell.title, createdAt: ts, updatedAt: ts });
      await db.books.put({ projectId: id, book: workspaceRow(shell), updatedAt: ts });
      await logHistory(id, 'Project created');
    });
    await listProjects();
    return id;
  }

  async function loadProject(id, silent) {
    const project = await db.projects.get(id);
    if (!project) return null;
    const book = await db.books.get(id);
    const rows = await db.sources.where('projectId').equals(id).toArray();
    const extractedRows = await db.extracted.where('projectId').equals(id).toArray();
    const extractedBySrc = new Map(extractedRows.map((e) => [e.sourceId, e.pages]));

    const shell = DEFAULT_SHELL(project.title);
    const ws = { ...shell, ...(book ? book.book : {}), sources: rows.map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size,
      type: r.type,
      status: r.status,
      pageCount: r.pageCount,
      wordCount: r.wordCount,
      pages: extractedBySrc.get(r.id) || []
    })) };

    const state = store.getState();
    state._actions.setWorkspace(ws);
    state._actions.setSettings(await readSettings());
    state.activeProjectId = id;
    store.setState({ activeProjectId: id, workspace: ws });

    const settings = store.getState().settings;
    await writeSettings({ ...settings, activeProject: id });

    if (!silent) { await listProjects(); }
    if (hooks.onWorkspaceLoaded) hooks.onWorkspaceLoaded(ws, ws.sources);
    if (hooks.onSourcesChanged) hooks.onSourcesChanged(ws.sources);
    return { workspace: ws, sources: ws.sources };
  }

  async function deleteProject(id) {
    await db.transaction('rw', db.projects, db.sources, db.extracted, db.books, db.history, async () => {
      await db.sources.where('projectId').equals(id).delete();
      await db.extracted.where('projectId').equals(id).delete();
      await db.books.delete(id);
      await db.history.where('projectId').equals(id).delete();
      await db.projects.delete(id);
    });
    const state = store.getState();
    if (state.activeProjectId === id) {
      state.activeProjectId = null;
      const settings = store.getState().settings;
      await writeSettings({ ...settings, activeProject: null });
    }
    await listProjects();
  }

  /* ------------------------------------------------------------------ *
   *  Source file storage (raw blobs, pending status)
   * ------------------------------------------------------------------ */
  async function addSourceFile(projectId, file, extra) {
    const ts = nowIso();
    const id = uid('src');
    const record = {
      id,
      projectId,
      name: file.name || 'source',
      size: file.size || 0,
      type: (file.type || '').split('/')[0] || (extra && extra.type) || 'file',
      status: 'pending',
      addedAt: ts,
      updatedAt: ts,
      pageCount: 0,
      wordCount: 0,
      blob: file
    };
    await db.sources.put(record);
    await db.extracted.put({ id, projectId, sourceId: id, pages: [], updatedAt: ts });
    return { id, name: record.name, size: record.size, type: record.type, status: 'pending' };
  }

  async function updateSource(projectId, sourceId, patch) {
    await db.sources.update(sourceId, { ...patch, updatedAt: nowIso() });
  }

  async function storeExtracted(projectId, sourceId, pages) {
    await db.extracted.put({ id: sourceId, projectId, sourceId, pages, updatedAt: nowIso() });
  }

  /* ------------------------------------------------------------------ *
   *  Debounced autosave (Zustand state -> Dexie)
   * ------------------------------------------------------------------ */
  let saveTimer = null;
  let saveBusy = false;

  function scheduleSave(delayMs) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (hooks.onSaveStatus) hooks.onSaveStatus('saving', null);
      await performSave(false);
    }, delayMs || 800);
  }

  async function performSave(explicit) {
    if (saveBusy) return;
    saveBusy = true;
    const state = store.getState();
    const projectId = state.activeProjectId;
    try {
      if (!projectId || !state.workspace) return;
      const ts = nowIso();
      await db.transaction('rw', db.projects, db.books, db.sources, db.extracted, db.history, async () => {
        const ws = state.workspace;
        await db.projects.update(projectId, { title: ws.title, updatedAt: ts });
        await db.books.put({ projectId, book: workspaceRow(ws), updatedAt: ts });

        for (const s of ws.sources || []) {
          await db.sources.update(s.id, {
            status: s.status,
            pageCount: s.pageCount || 0,
            wordCount: s.wordCount || 0,
            name: s.name,
            updatedAt: ts
          });
          if (Array.isArray(s.pages) && s.pages.length) {
            await db.extracted.put({ id: s.id, projectId, sourceId: s.id, pages: s.pages, updatedAt: ts });
          }
        }
        await logHistory(projectId, explicit ? 'Manual save' : 'Autosave');
      });
      state._actions.markSaved(ts);
      if (hooks.onSaveStatus) hooks.onSaveStatus('saved', ts);
    } catch (err) {
      if (hooks.onSaveStatus) hooks.onSaveStatus('error', null);
      if (typeof console !== 'undefined') console.error('pdf2book autosave failed:', err);
    } finally {
      saveBusy = false;
    }
  }

  async function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await performSave(false);
  }

  /* ------------------------------------------------------------------ *
   *  Backup: dump the WHOLE Dexie state to a downloadable JSON file
   * ------------------------------------------------------------------ */
  async function buildBackup() {
    const dump = { app: 'pdf2book', formatVersion: 1, exportedAt: nowIso(), db: {} };
    for (const table of db.tables) {
      const rows = await table.toArray();
      dump.db[table.name] = rows.map((row) => serializeValue(row));
    }
    return dump;
  }

  async function exportBackup() {
    const dump = await buildBackup();
    if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const stamp = d.toISOString().slice(0, 10);
      a.download = 'pdf2book-backup-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
    return dump;
  }

  /* ------------------------------------------------------------------ *
   *  Init
   * ------------------------------------------------------------------ */
  async function init(options) {
    const opts = options || {};
    await db.open();

    let settings = await readSettings();
    let projects = await db.projects.orderBy('updatedAt').reverse().toArray();

    if (!projects.length) {
      const id = await createProject(opts.firstProjectTitle);
      settings = { ...settings, activeProject: id };
      await writeSettings(settings);
      projects = await db.projects.orderBy('updatedAt').reverse().toArray();
    }

    store.getState()._actions.setSettings(settings);
    store.getState()._actions.setProjects(projects);
    store.getState()._actions.setReady(true);

    let activeId = settings.activeProject;
    if (!activeId && projects.length) activeId = projects[0].id;

    let workspace = null;
    let sources = [];
    if (activeId) {
      const loaded = await loadProject(activeId, true);
      if (loaded) { workspace = loaded.workspace; sources = loaded.sources; }
    }

    if (hooks.onProjectsChanged) hooks.onProjectsChanged(projects);
    if (hooks.onWorkspaceLoaded) hooks.onWorkspaceLoaded(workspace, sources);
    if (hooks.onSourcesChanged) hooks.onSourcesChanged(sources);

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('pagehide', () => { flushSave(); });
    }
    return { projects, workspace, sources };
  }

  /* ------------------------------------------------------------------ *
   *  Public API
   * ------------------------------------------------------------------ */
  return {
    db,
    store,
    setHooks,
    init,
    uid,

    listProjects,
    createProject,
    loadProject,
    deleteProject,

    addSourceFile,
    updateSource,
    storeExtracted,

    scheduleSave,
    flushSave,
    logHistory,
    readSettings,
    writeSettings,

    buildBackup,
    exportBackup,

    getState: () => store.getState(),
    getWorkspace: () => store.getState().workspace,
    setWorkspace: (ws) => { store.getState()._actions.setWorkspace(ws); return ws; },
    defaultShell: DEFAULT_SHELL,
    DB_NAME
  };
});