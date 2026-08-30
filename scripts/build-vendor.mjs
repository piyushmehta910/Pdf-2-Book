/**
 * Bundles the local-first client runtime (Dexie + Zustand vanilla) into a
 * single IIFE that exposes `window.LocalFirst = { Dexie, createStore }`.
 * Run with: npm run build:vendor
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(root, 'scripts', 'vendor-entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'LocalFirst',
  minify: true,
  target: ['es2020'],
  outfile: path.join(root, 'public', 'vendor', 'local-first.js'),
  sourcemap: false,
  logLevel: 'info'
});