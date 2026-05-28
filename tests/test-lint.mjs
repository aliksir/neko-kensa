import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { KensaDB } from '../src/db.mjs';
import { runLint } from '../src/lint.mjs';
import { createTestDB, insertFile, insertDependency, insertSymbol, createTempDir, cleanupTempDir } from './helpers.mjs';

describe('lint - large-file', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    insertFile(db, 'src/big.ts', 'typescript', 500);
    insertFile(db, 'src/small.ts', 'typescript', 50);
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('detects large files', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(hasIssues);
      assert.ok(output.includes('large-file'));
      assert.ok(output.includes('src/big.ts'));
      assert.ok(!output.includes('src/small.ts'));
    } finally { db.close(); }
  });
});

describe('lint - high-fan-out', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    const hub = insertFile(db, 'src/hub.ts', 'typescript');
    for (let i = 0; i < 20; i++) {
      const target = insertFile(db, `src/mod${i}.ts`, 'typescript');
      insertDependency(db, hub, target, `./mod${i}`);
    }
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('detects high fan-out', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(hasIssues);
      assert.ok(output.includes('high-fan-out'));
      assert.ok(output.includes('src/hub.ts'));
    } finally { db.close(); }
  });
});

describe('lint - high-fan-in', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    const shared = insertFile(db, 'src/shared.ts', 'typescript');
    for (let i = 0; i < 25; i++) {
      const consumer = insertFile(db, `src/consumer${i}.ts`, 'typescript');
      insertDependency(db, consumer, shared, '../shared');
    }
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('detects high fan-in', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(hasIssues);
      assert.ok(output.includes('high-fan-in'));
      assert.ok(output.includes('src/shared.ts'));
    } finally { db.close(); }
  });
});

describe('lint - unresolved-import', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    const f = insertFile(db, 'src/app.ts', 'typescript');
    db.exec(`INSERT INTO dependencies (source_file_id, target_file_id, target_module, kind) VALUES (${f}, NULL, 'missing-module', 'import')`);
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('detects unresolved imports', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(hasIssues);
      assert.ok(output.includes('unresolved-import'));
      assert.ok(output.includes('missing-module'));
    } finally { db.close(); }
  });
});

describe('lint - deep-inheritance', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    const f = insertFile(db, 'src/classes.py', 'python');
    // A -> B -> C -> D -> E -> F -> G (depth 7)
    const classes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    for (let i = 1; i < classes.length; i++) {
      db.exec(`INSERT INTO inheritance (child_file_id, child_class, parent_class, line) VALUES (${f}, '${classes[i]}', '${classes[i-1]}', ${i * 10})`);
    }
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('detects deep inheritance chains', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(hasIssues);
      assert.ok(output.includes('deep-inheritance'));
    } finally { db.close(); }
  });
});

describe('lint - many-symbols', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    const f = insertFile(db, 'src/god.ts', 'typescript');
    for (let i = 0; i < 35; i++) {
      insertSymbol(db, f, `func${i}`, 'function', i * 10, i * 10 + 5);
    }
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('detects files with many symbols', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(hasIssues);
      assert.ok(output.includes('many-symbols'));
      assert.ok(output.includes('src/god.ts'));
    } finally { db.close(); }
  });
});

describe('lint - no issues', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    insertFile(db, 'src/clean.ts', 'typescript', 50);
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('reports no issues', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runLint(db);
      assert.ok(!hasIssues);
      assert.ok(output.includes('No lint issues'));
    } finally { db.close(); }
  });
});

describe('lint - custom thresholds', () => {
  let tmpDir, dbPath;
  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const db = createTestDB(dbPath);
    insertFile(db, 'src/medium.ts', 'typescript', 400);
    db.close();
  });
  after(() => cleanupTempDir(tmpDir));

  it('respects custom thresholds from rules file', () => {
    const rulesPath = join(tmpDir, '.neko-kensa.json');
    writeFileSync(rulesPath, JSON.stringify({ lint: { 'large-file': { max: 500 } } }));

    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { hasIssues } = runLint(db, { rulesFile: rulesPath });
      assert.ok(!hasIssues, 'should not flag 400-line file when max is 500');
    } finally { db.close(); }
  });
});
