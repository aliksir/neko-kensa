import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { KensaDB } from '../src/db.mjs';
import { runGraph } from '../src/graph.mjs';
import { createTestDB, insertFile, insertDependency, createTempDir, cleanupTempDir } from './helpers.mjs';

describe('graph deps', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const rawDb = createTestDB(dbPath);
    const a = insertFile(rawDb, 'src/a.ts', 'typescript');
    const b = insertFile(rawDb, 'src/b.ts', 'typescript');
    const c = insertFile(rawDb, 'lib/c.ts', 'typescript');
    insertDependency(rawDb, a, b, './b');
    insertDependency(rawDb, b, c, '../lib/c');
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('generates HTML with nodes and edges', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'deps' });
      assert.ok(html.includes('<!DOCTYPE html>'));
      assert.ok(html.includes('Dependency Graph'));
      assert.ok(html.includes('src/a.ts'));
      assert.ok(html.includes('src/b.ts'));
      assert.ok(html.includes('lib/c.ts'));
      assert.ok(html.includes('canvas'));
    } finally {
      db.close();
    }
  });

  it('supports --dir mode', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'deps', dir: true });
      assert.ok(html.includes('Dependency Graph'));
      assert.ok(html.includes('"src"') || html.includes('"lib"'));
    } finally {
      db.close();
    }
  });
});

describe('graph class', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const rawDb = createTestDB(dbPath);
    const f1 = insertFile(rawDb, 'src/animal.py', 'python');
    const f2 = insertFile(rawDb, 'src/dog.py', 'python');
    rawDb.exec(`INSERT INTO inheritance (child_file_id, child_class, parent_class, line, parent_file_id) VALUES (${f2}, 'Dog', 'Animal', 5, ${f1})`);
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('generates class hierarchy HTML', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'class' });
      assert.ok(html.includes('Class Hierarchy'));
      assert.ok(html.includes('Dog'));
      assert.ok(html.includes('Animal'));
    } finally {
      db.close();
    }
  });
});

describe('graph calls', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const rawDb = createTestDB(dbPath);
    const f1 = insertFile(rawDb, 'src/main.py', 'python');
    const f2 = insertFile(rawDb, 'src/utils.py', 'python');
    rawDb.exec(`INSERT INTO calls (caller_file_id, caller_symbol, callee_name, line) VALUES (${f1}, 'main', 'format_output', 10)`);
    rawDb.exec(`INSERT INTO calls (caller_file_id, caller_symbol, callee_name, line, callee_file_id) VALUES (${f1}, 'main', 'helper', 15, ${f2})`);
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('generates call graph HTML', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'calls' });
      assert.ok(html.includes('Call Graph'));
      assert.ok(html.includes('main'));
      assert.ok(html.includes('format_output'));
      assert.ok(html.includes('helper'));
    } finally {
      db.close();
    }
  });
});

describe('graph empty data', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const rawDb = createTestDB(dbPath);
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('shows no-data message for deps', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'deps' });
      assert.ok(html.includes('No dependency data'));
    } finally {
      db.close();
    }
  });

  it('shows no-data message for class', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'class' });
      assert.ok(html.includes('No inheritance data'));
    } finally {
      db.close();
    }
  });

  it('shows no-data message for calls', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const html = runGraph(db, { type: 'calls' });
      assert.ok(html.includes('No call data'));
    } finally {
      db.close();
    }
  });
});
