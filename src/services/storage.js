const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function projectDir(projectId) {
  const dir = path.resolve(config.dataDir, projectId);
  ensureDir(dir);
  return dir;
}

function collectionPath(projectId, name) {
  return path.join(projectDir(projectId), `${name}.json`);
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function readCollection(projectId, name) {
  const file = collectionPath(projectId, name);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    return [];
  }
}

function writeCollection(projectId, name, items) {
  fs.writeFileSync(collectionPath(projectId, name), JSON.stringify(items, null, 2), 'utf8');
}

async function insert(projectId, name, item) {
  const items = readCollection(projectId, name);
  items.push(item);
  writeCollection(projectId, name, items);
  return item;
}

async function updateById(projectId, name, itemId, patch) {
  const items = readCollection(projectId, name);
  const index = items.findIndex((x) => x.id === itemId);
  if (index === -1) return null;
  items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
  writeCollection(projectId, name, items);
  return items[index];
}

async function removeById(projectId, name, itemId) {
  const items = readCollection(projectId, name);
  const filtered = items.filter((x) => x.id !== itemId);
  writeCollection(projectId, name, filtered);
  return filtered.length !== items.length;
}

function find(projectId, name, predicate) {
  return readCollection(projectId, name).filter(predicate);
}

function findById(projectId, name, itemId) {
  return readCollection(projectId, name).find((x) => x.id === itemId) || null;
}

function replaceAll(projectId, name, items) {
  writeCollection(projectId, name, items);
}

module.exports = {
  id,
  readCollection,
  writeCollection,
  insert,
  updateById,
  removeById,
  find,
  findById,
  replaceAll
};
