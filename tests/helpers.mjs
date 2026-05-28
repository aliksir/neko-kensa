import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    last_modified REAL NOT NULL,
    last_indexed REAL NOT NULL,
    line_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    target_module TEXT NOT NULL,
    kind TEXT NOT NULL,
    imported_symbols TEXT
);
CREATE TABLE IF NOT EXISTS references_ (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    symbol_name TEXT NOT NULL,
    line INTEGER NOT NULL,
    resolved_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    caller_symbol TEXT,
    callee_name TEXT NOT NULL,
    line INTEGER NOT NULL,
    callee_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    UNIQUE(caller_file_id, line, callee_name)
);
CREATE TABLE IF NOT EXISTS inheritance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    child_class TEXT NOT NULL,
    parent_class TEXT NOT NULL,
    line INTEGER NOT NULL,
    parent_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    UNIQUE(child_file_id, child_class, parent_class)
);
`;

export function createTestDB(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(CREATE_TABLES);
  db.exec("INSERT INTO metadata (key, value) VALUES ('schema_version', '1')");
  db.exec("INSERT INTO metadata (key, value) VALUES ('repository_path', '/test/repo')");
  return db;
}

export function insertFile(db, path, language, lineCount = 10) {
  db.exec(
    `INSERT INTO files (path, language, content_hash, last_modified, last_indexed, line_count)
     VALUES ('${path}', '${language}', 'hash_${path}', 1000, 1000, ${lineCount})`
  );
  return db.prepare('SELECT id FROM files WHERE path = ?').get(path).id;
}

export function insertDependency(db, sourceId, targetId, module) {
  db.exec(
    `INSERT INTO dependencies (source_file_id, target_file_id, target_module, kind)
     VALUES (${sourceId}, ${targetId}, '${module}', 'import')`
  );
}

export function insertSymbol(db, fileId, name, kind, lineStart, lineEnd) {
  db.exec(
    `INSERT INTO symbols (file_id, name, kind, line_start, line_end)
     VALUES (${fileId}, '${name}', '${kind}', ${lineStart}, ${lineEnd})`
  );
}

export function createTempDir() {
  const dir = join(tmpdir(), `neko-kensa-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTempDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

export function writeRulesFile(dir, rules) {
  const filePath = join(dir, '.neko-kensa.json');
  writeFileSync(filePath, JSON.stringify({ "$schema": "neko-kensa-rules-v1", rules }, null, 2));
  return filePath;
}
