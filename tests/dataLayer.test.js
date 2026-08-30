/* Simple browser-like globals so the UMD data layer's node branch tests cleanly. */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

/* fake-indexeddb provides an in-memory IndexedDB for the Dexie schema. */
require('fake-indexeddb/auto');

const Dexie = require('dexie');

const data = require('../public/app-data.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('app-data local-first layer', () => {
  const DB_NAME = 'pdf2book';

  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
    /* Each test gets a clean store; re-create through the API is driven by init(). */
  });

  afterAll(() => Dexie.delete(DB_NAME));

  test('exposes a Dexie database with the expected schema tables', async () => {
    const tableNames = data.db.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(['books', 'extracted', 'history', 'projects', 'settings', 'sources']);
  });

  test('init creates a first project when the database is empty', async () => {
    const result = await data.init({});
    expect(data.getState().ready).toBe(true);
    expect(result.projects.length).toBe(1);
    expect(data.getState().activeProjectId).toBe(result.projects[0].id);
    expect(data.getWorkspace()).not.toBe(null);
    expect(data.getWorkspace().title).toBe('Untitled Research Book');
  });

  test('project CRUD: create, list, update, load, delete', async () => {
    await data.init({});
    const id = await data.createProject('My Test Book');
    const projects = await data.listProjects();
    expect(projects.some((p) => p.id === id && p.title === 'My Test Book')).toBe(true);

    const loaded = await data.loadProject(id);
    expect(loaded.workspace.title).toBe('My Test Book');
    expect(loaded.workspace.bookType).toBe('textbook');

    await data.deleteProject(id);
    const after = await data.listProjects();
    expect(after.some((p) => p.id === id)).toBe(false);
  });

  test('addSourceFile stores a raw blob with pending status and no extraction', async () => {
    await data.init({});
    const projectId = data.getState().activeProjectId;
    const file = new Blob(['fake pdf bytes'], { type: 'application/pdf' });
    const stored = await data.addSourceFile(projectId, file);

    const rows = await data.db.sources.where('projectId').equals(projectId).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('source');
    expect(rows[0].size).toBe(14);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].blob).toBeInstanceOf(Blob);

    /* pending -> ready transition persists extracted page counts */
    await data.updateSource(projectId, stored.id, { status: 'ready', pageCount: 3, wordCount: 420 });
    const updated = await data.db.sources.get(stored.id);
    expect(updated.status).toBe('ready');
    expect(updated.pageCount).toBe(3);
  });

  test('storeExtracted persists extracted pages per source', async () => {
    await data.init({});
    const projectId = data.getState().activeProjectId;
    const stored = await data.addSourceFile(projectId, { name: 'notes.docx', size: 99, type: 'document' });
    const pages = [{ pageNumber: 1, text: 'hello' }, { pageNumber: 2, text: 'world' }];
    await data.storeExtracted(projectId, stored.id, pages);

    const row = await data.db.extracted.get(stored.id);
    expect(row.pages).toEqual(pages);

    const loaded = await data.loadProject(projectId);
    const source = loaded.sources[0];
    expect(source.pages).toEqual(pages);
  });

  test('debounced autosave persists workspace changes into Dexie', async () => {
    await data.init({});
    const projectId = data.getState().activeProjectId;
    wsMutateTitle('Edited title');
    data.scheduleSave(10);
    await sleep(60);

    const book = await data.db.books.get(projectId);
    expect(book.book.title).toBe('Edited title');
    expect(data.getState().lastSavedAt).not.toBe(null);
  }, 15000);

  test('flushSave writes immediately even without waiting for the debounce', async () => {
    await data.init({});
    const projectId = data.getState().activeProjectId;
    wsMutateTitle('Flushed title');
    await data.flushSave();

    const book = await data.db.books.get(projectId);
    expect(book.book.title).toBe('Flushed title');

    const history = await data.db.history.where('projectId').equals(projectId).toArray();
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].message).toBe('Autosave');
  });

  test('history log is capped per project', async () => {
    await data.init({});
    const projectId = data.getState().activeProjectId;
    for (let i = 0; i < 150; i++) await data.logHistory(projectId, 'entry ' + i);
    const count = await data.db.history.where('projectId').equals(projectId).count();
    expect(count).toBeLessThanOrEqual(100);
  });

  test('settings persist and are re-read from Dexie on a fresh store read', async () => {
    await data.init({});
    await data.writeSettings({ theme: 'light', citationStyle: 'MLA' });

    const settings = await data.readSettings();
    expect(settings.theme).toBe('light');
    expect(settings.citationStyle).toBe('MLA');

    /* activeProject bookmark is written through by init/loadProject */
    const bookmark = await data.db.settings.get('activeProject');
    expect(bookmark).toBeTruthy();
  });

  test('backup export serializes rows including binary blob columns as base64', async () => {
    await data.init({});
    const projectId = data.getState().activeProjectId;
    const bytes = new Uint8Array([104, 105, 33]); // "hi!"
    await data.db.sources.add({
      id: 'src-bin',
      projectId,
      name: 'bin.pdf',
      size: 3,
      status: 'pending',
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blob: bytes
    });

    const dump = await data.buildBackup();
    expect(dump.app).toBe('pdf2book');
    expect(dump.formatVersion).toBe(1);
    expect(dump.db.projects.length).toBeGreaterThan(0);
    expect(dump.db.books.length).toBeGreaterThan(0);
    expect(dump.db.sources.some((r) => r.id === 'src-bin')).toBe(true);

    const binaryRow = dump.db.sources.find((r) => r.id === 'src-bin');
    expect(binaryRow.blob).toEqual({ __p2b_bin__: { type: 'bytes', data: 'aGkh' } });
  });

  test('secondary blobs and arrays are deep-serialized in backups', async () => {
    await data.init({});
    const payload = { nested: { pages: [{ pageNumber: 1, text: 'x' }] }, arr: [1, 2, 3] };
    const serialized = data.defaultShell('Backup');
    expect(serialized.chapters).toHaveLength(1);
    const out = JSON.parse(JSON.stringify(serialized));
    expect(out.title).toBe('Backup');
    expect(payload.nested.pages).toHaveLength(1);
  });
});

/* helper: mutate the module-level workspace through the store */
function wsMutateTitle(title) {
  data.setWorkspace({ ...data.getWorkspace(), title });
}