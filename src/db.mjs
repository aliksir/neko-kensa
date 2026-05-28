import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const EXPECTED_SCHEMA_VERSION = '1';

export class KensaDB {
  #dbPath;
  #db;

  constructor(dbPath) {
    this.#dbPath = dbPath || join(homedir(), '.code-graph', 'graph.db');
    this.#db = null;
  }

  open() {
    if (!existsSync(this.#dbPath)) {
      throw new Error(
        `graph.db not found at ${this.#dbPath}. Run 'code-graph index_repository' first.`
      );
    }
    this.#db = new DatabaseSync(this.#dbPath, { open: true, readOnly: true });

    const row = this.#db.prepare(
      "SELECT value FROM metadata WHERE key = 'schema_version'"
    ).get();
    if (!row) {
      throw new Error('graph.db has no schema_version in metadata table.');
    }
    if (row.value !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `graph.db schema version mismatch (expected ${EXPECTED_SCHEMA_VERSION}, got ${row.value}). Update code-graph.`
      );
    }
  }

  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }

  get dbPath() {
    return this.#dbPath;
  }

  getAllFiles() {
    return this.#db.prepare(
      'SELECT id, path, language, line_count FROM files'
    ).all();
  }

  getFileByPath(path) {
    return this.#db.prepare(
      'SELECT id, path, language, line_count FROM files WHERE path = ?'
    ).get(path) || null;
  }

  getFileIdByPath(path) {
    const row = this.#db.prepare(
      'SELECT id FROM files WHERE path = ?'
    ).get(path);
    return row ? row.id : null;
  }

  getFileDependencies(fileId) {
    return this.#db.prepare(
      'SELECT target_file_id, target_module, kind FROM dependencies WHERE source_file_id = ? AND target_file_id IS NOT NULL'
    ).all(fileId);
  }

  getFileDependents(fileId) {
    return this.#db.prepare(
      'SELECT d.source_file_id, f.path AS source_path FROM dependencies d JOIN files f ON d.source_file_id = f.id WHERE d.target_file_id = ?'
    ).all(fileId);
  }

  getFileSymbols(fileId) {
    return this.#db.prepare(
      'SELECT id, name, kind, line_start, line_end FROM symbols WHERE file_id = ?'
    ).all(fileId);
  }

  getSymbolReferences(name) {
    return this.#db.prepare(
      'SELECT file_id, line FROM references_ WHERE symbol_name = ?'
    ).all(name);
  }

  getAllDependencyEdges() {
    return this.#db.prepare(
      'SELECT source_file_id, target_file_id FROM dependencies WHERE target_file_id IS NOT NULL'
    ).all();
  }

  getAllDependencyEdgesWithPaths() {
    return this.#db.prepare(
      `SELECT sf.path AS source_path, tf.path AS target_path
       FROM dependencies d
       JOIN files sf ON d.source_file_id = sf.id
       JOIN files tf ON d.target_file_id = tf.id
       WHERE d.target_file_id IS NOT NULL`
    ).all();
  }

  getStats() {
    const files = this.#db.prepare('SELECT COUNT(*) AS c FROM files').get().c;
    const symbols = this.#db.prepare('SELECT COUNT(*) AS c FROM symbols').get().c;
    const dependencies = this.#db.prepare('SELECT COUNT(*) AS c FROM dependencies').get().c;
    const byLanguage = {};
    for (const row of this.#db.prepare('SELECT language, COUNT(*) AS c FROM files GROUP BY language').all()) {
      byLanguage[row.language] = row.c;
    }
    return { files, symbols, dependencies, byLanguage };
  }

  getRepositoryPath() {
    const row = this.#db.prepare(
      "SELECT value FROM metadata WHERE key = 'repository_path'"
    ).get();
    return row ? row.value : null;
  }
}
