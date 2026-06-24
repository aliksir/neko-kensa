// code-graph MCP が生成した graph.db への読み取り専用アクセサ
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// code-graph と合わせてスキーマバージョンを管理（不一致は更新を促すエラーで弾く）
const EXPECTED_SCHEMA_VERSION = '1';

export class KensaDB {
  #dbPath;
  #db;

  constructor(dbPath) {
    // dbPath 未指定時はデフォルト位置（~/.code-graph/graph.db）を使用
    this.#dbPath = dbPath || join(homedir(), '.code-graph', 'graph.db');
    this.#db = null;
  }

  // DB を読み取り専用で開いてスキーマバージョンを検証する
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

  // 指定ファイルが依存するファイル一覧を返す（未解決 import は除外）
  getFileDependencies(fileId) {
    return this.#db.prepare(
      'SELECT target_file_id, target_module, kind FROM dependencies WHERE source_file_id = ? AND target_file_id IS NOT NULL'
    ).all(fileId);
  }

  // 指定ファイルに依存するファイル一覧を返す（ファンイン計算用）
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

  getAllCallsWithPaths() {
    return this.#db.prepare(
      `SELECT f1.path AS caller_path, c.caller_symbol, c.callee_name, f2.path AS callee_path
       FROM calls c
       JOIN files f1 ON c.caller_file_id = f1.id
       LEFT JOIN files f2 ON c.callee_file_id = f2.id`
    ).all();
  }

  getAllInheritanceWithPaths() {
    return this.#db.prepare(
      `SELECT f1.path AS child_path, i.child_class, i.parent_class, f2.path AS parent_path
       FROM inheritance i
       JOIN files f1 ON i.child_file_id = f1.id
       LEFT JOIN files f2 ON i.parent_file_id = f2.id`
    ).all();
  }

  getLargeFiles(maxLines) {
    return this.#db.prepare(
      'SELECT path, language, line_count FROM files WHERE line_count > ? ORDER BY line_count DESC'
    ).all(maxLines);
  }

  getHighFanOut(maxImports) {
    return this.#db.prepare(
      `SELECT f.path, f.language, COUNT(*) AS import_count
       FROM dependencies d JOIN files f ON d.source_file_id = f.id
       WHERE d.target_file_id IS NOT NULL
       GROUP BY d.source_file_id HAVING COUNT(*) > ?
       ORDER BY import_count DESC`
    ).all(maxImports);
  }

  getHighFanIn(maxDependents) {
    return this.#db.prepare(
      `SELECT f.path, f.language, COUNT(*) AS dependent_count
       FROM dependencies d JOIN files f ON d.target_file_id = f.id
       WHERE d.target_file_id IS NOT NULL
       GROUP BY d.target_file_id HAVING COUNT(*) > ?
       ORDER BY dependent_count DESC`
    ).all(maxDependents);
  }

  getUnresolvedImports() {
    return this.#db.prepare(
      `SELECT f.path AS source_path, d.target_module
       FROM dependencies d JOIN files f ON d.source_file_id = f.id
       WHERE d.target_file_id IS NULL
       ORDER BY f.path`
    ).all();
  }

  getManySymbols(maxSymbols) {
    return this.#db.prepare(
      `SELECT f.path, f.language, COUNT(*) AS symbol_count
       FROM symbols s JOIN files f ON s.file_id = f.id
       GROUP BY s.file_id HAVING COUNT(*) > ?
       ORDER BY symbol_count DESC`
    ).all(maxSymbols);
  }

  getInheritanceChains() {
    return this.#db.prepare(
      'SELECT child_class, parent_class FROM inheritance'
    ).all();
  }

  getRepositoryPath() {
    const row = this.#db.prepare(
      "SELECT value FROM metadata WHERE key = 'repository_path'"
    ).get();
    return row ? row.value : null;
  }
}
