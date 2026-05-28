import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { KensaDB } from '../src/db.mjs';
import { runDead } from '../src/dead.mjs';
import { createTestDB, insertFile, insertDependency, createTempDir, cleanupTempDir } from './helpers.mjs';

describe('dead', () => {
  let tmpDir, dbPath, rawDb;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    rawDb = createTestDB(dbPath);

    // Graph: entry -> a -> b, c is orphan
    const entry = insertFile(rawDb, 'src/index.ts', 'typescript', 20);
    const a = insertFile(rawDb, 'src/a.ts', 'typescript', 30);
    const b = insertFile(rawDb, 'src/b.ts', 'typescript', 15);
    const c = insertFile(rawDb, 'src/orphan.ts', 'typescript', 50);
    const d = insertFile(rawDb, 'src/also-orphan.ts', 'typescript', 10);

    insertDependency(rawDb, entry, a, './a');
    insertDependency(rawDb, a, b, './b');
    // c and d have no incoming edges from entry
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('detects dead files with explicit entry', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const output = runDead(db, { entries: ['src/index.ts'] });
      assert.ok(output.includes('src/orphan.ts'), 'should list orphan.ts');
      assert.ok(output.includes('src/also-orphan.ts'), 'should list also-orphan.ts');
      assert.ok(!output.includes('src/a.ts'), 'should not list a.ts');
      assert.ok(!output.includes('src/b.ts'), 'should not list b.ts');
      assert.ok(output.includes('2 dead files'));
    } finally {
      db.close();
    }
  });

  it('returns JSON output', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const output = runDead(db, { entries: ['src/index.ts'], json: true });
      const parsed = JSON.parse(output);
      assert.equal(parsed.dead_count, 2);
      assert.equal(parsed.total_files, 5);
      assert.ok(parsed.dead_percentage > 0);
      assert.equal(parsed.dead_files.length, 2);
    } finally {
      db.close();
    }
  });

  it('reports no dead files when all reachable', () => {
    const dir2 = createTempDir();
    const dbPath2 = join(dir2, 'graph.db');
    const db2 = createTestDB(dbPath2);
    const f1 = insertFile(db2, 'src/main.ts', 'typescript');
    const f2 = insertFile(db2, 'src/util.ts', 'typescript');
    insertDependency(db2, f1, f2, './util');
    db2.close();

    const kdb = new KensaDB(dbPath2);
    kdb.open();
    try {
      const output = runDead(kdb, { entries: ['src/main.ts'] });
      assert.ok(output.includes('No dead files found'));
    } finally {
      kdb.close();
      cleanupTempDir(dir2);
    }
  });

  it('warns when no entry points found', () => {
    const dir3 = createTempDir();
    const dbPath3 = join(dir3, 'graph.db');
    const db3 = createTestDB(dbPath3);
    insertFile(db3, 'src/x.ts', 'typescript');
    db3.close();

    const kdb = new KensaDB(dbPath3);
    kdb.open();
    try {
      const output = runDead(kdb, { entries: [], repoPath: dir3 });
      assert.ok(output.includes('Warning') || output.includes('No dead files'));
    } finally {
      kdb.close();
      cleanupTempDir(dir3);
    }
  });
});
