import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { KensaDB } from '../src/db.mjs';
import { runStats } from '../src/stats.mjs';
import { createTestDB, insertFile, insertDependency, insertSymbol, createTempDir, cleanupTempDir } from './helpers.mjs';

describe('stats', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const rawDb = createTestDB(dbPath);

    const f1 = insertFile(rawDb, 'src/main.ts', 'typescript', 100);
    const f2 = insertFile(rawDb, 'src/util.ts', 'typescript', 50);
    const f3 = insertFile(rawDb, 'lib/helper.py', 'python', 30);

    insertDependency(rawDb, f1, f2, './util');
    insertSymbol(rawDb, f1, 'main', 'function', 1, 10);
    insertSymbol(rawDb, f2, 'format', 'function', 1, 5);
    insertSymbol(rawDb, f3, 'help', 'function', 1, 3);

    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('shows text stats', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const output = runStats(db);
      assert.ok(output.includes('Files: 3'));
      assert.ok(output.includes('Symbols: 3'));
      assert.ok(output.includes('Dependencies: 1'));
      assert.ok(output.includes('typescript'));
      assert.ok(output.includes('python'));
      assert.ok(output.includes('Circular dependencies: 0'));
    } finally {
      db.close();
    }
  });

  it('shows JSON stats', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const output = runStats(db, { json: true });
      const parsed = JSON.parse(output);
      assert.equal(parsed.files, 3);
      assert.equal(parsed.symbols, 3);
      assert.equal(parsed.dependencies, 1);
      assert.equal(parsed.circular_dependencies, 0);
      assert.equal(parsed.byLanguage.typescript, 2);
      assert.equal(parsed.byLanguage.python, 1);
    } finally {
      db.close();
    }
  });
});
