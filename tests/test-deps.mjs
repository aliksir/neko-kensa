import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { KensaDB } from '../src/db.mjs';
import { runDeps, detectCycles } from '../src/deps.mjs';
import { createTestDB, insertFile, insertDependency, createTempDir, cleanupTempDir, writeRulesFile } from './helpers.mjs';

describe('deps - circular dependency detection', () => {
  let tmpDir, dbPath, rawDb;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    rawDb = createTestDB(dbPath);

    // Cycle: a -> b -> c -> a
    const a = insertFile(rawDb, 'src/a.ts', 'typescript');
    const b = insertFile(rawDb, 'src/b.ts', 'typescript');
    const c = insertFile(rawDb, 'src/c.ts', 'typescript');
    const d = insertFile(rawDb, 'src/d.ts', 'typescript');

    insertDependency(rawDb, a, b, './b');
    insertDependency(rawDb, b, c, './c');
    insertDependency(rawDb, c, a, './a');
    insertDependency(rawDb, d, a, './a');  // d -> a but not in cycle
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('detects circular dependencies', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runDeps(db);
      assert.ok(hasIssues, 'should report issues');
      assert.ok(output.includes('Circular dependencies:'));
      assert.ok(output.includes('src/a.ts'));
      assert.ok(output.includes('src/b.ts'));
      assert.ok(output.includes('src/c.ts'));
      assert.ok(output.includes('3 files'));
      assert.ok(output.includes('1 cycles'));
    } finally {
      db.close();
    }
  });

  it('returns JSON output for cycles', () => {
    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output } = runDeps(db, { json: true });
      const parsed = JSON.parse(output);
      assert.equal(parsed.cycle_count, 1);
      assert.equal(parsed.cycles[0].size, 3);
    } finally {
      db.close();
    }
  });
});

describe('deps - no cycles', () => {
  it('reports no circular dependencies', () => {
    const dir = createTempDir();
    const dbPath2 = join(dir, 'graph.db');
    const db2 = createTestDB(dbPath2);
    const f1 = insertFile(db2, 'src/main.ts', 'typescript');
    const f2 = insertFile(db2, 'src/util.ts', 'typescript');
    insertDependency(db2, f1, f2, './util');
    db2.close();

    const kdb = new KensaDB(dbPath2);
    kdb.open();
    try {
      const { output, hasIssues } = runDeps(kdb);
      assert.ok(!hasIssues);
      assert.ok(output.includes('No circular dependencies found'));
      assert.ok(output.includes('0 cycles'));
    } finally {
      kdb.close();
      cleanupTempDir(dir);
    }
  });
});

describe('deps - rule violations', () => {
  let tmpDir, dbPath;

  before(() => {
    tmpDir = createTempDir();
    dbPath = join(tmpDir, 'graph.db');
    const rawDb = createTestDB(dbPath);

    const comp = insertFile(rawDb, 'src/components/Button.tsx', 'typescript');
    const srv = insertFile(rawDb, 'src/server/db.ts', 'typescript');
    const util = insertFile(rawDb, 'src/utils/format.ts', 'typescript');

    insertDependency(rawDb, comp, srv, '../server/db');   // violation
    insertDependency(rawDb, comp, util, '../utils/format'); // ok
    rawDb.close();
  });

  after(() => cleanupTempDir(tmpDir));

  it('detects rule violations from rules file', () => {
    const rulesPath = writeRulesFile(tmpDir, [
      {
        name: 'no-server-in-components',
        type: 'forbid',
        from: { pathPattern: '^src/components/' },
        to: { pathPattern: '^src/server/' },
        severity: 'error',
        message: 'components/ must not import from server/',
      },
    ]);

    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runDeps(db, { rulesFile: rulesPath });
      assert.ok(hasIssues);
      assert.ok(output.includes('no-server-in-components'));
      assert.ok(output.includes('src/components/Button.tsx'));
      assert.ok(output.includes('src/server/db.ts'));
      assert.ok(output.includes('1 rule violations'));
    } finally {
      db.close();
    }
  });

  it('passes when no rules violated', () => {
    const rulesPath = writeRulesFile(tmpDir, [
      {
        name: 'no-test-in-prod',
        type: 'forbid',
        from: { pathPattern: '^src/' },
        to: { pathPattern: '^tests/' },
        severity: 'error',
      },
    ]);

    const db = new KensaDB(dbPath);
    db.open();
    try {
      const { output, hasIssues } = runDeps(db, { rulesFile: rulesPath });
      assert.ok(!hasIssues);
      assert.ok(output.includes('0 rule violations'));
    } finally {
      db.close();
    }
  });
});

describe('detectCycles (unit)', () => {
  it('finds SCC of size >= 2', () => {
    const files = [
      { id: 1, path: 'a.ts' },
      { id: 2, path: 'b.ts' },
      { id: 3, path: 'c.ts' },
    ];
    const edges = [
      { source_file_id: 1, target_file_id: 2 },
      { source_file_id: 2, target_file_id: 1 },
      { source_file_id: 2, target_file_id: 3 },
    ];
    const { cycles } = detectCycles(edges, files);
    assert.equal(cycles.length, 1);
    assert.ok(cycles[0].includes('a.ts'));
    assert.ok(cycles[0].includes('b.ts'));
    assert.ok(!cycles[0].includes('c.ts'));
  });

  it('returns empty for acyclic graph', () => {
    const files = [
      { id: 1, path: 'a.ts' },
      { id: 2, path: 'b.ts' },
    ];
    const edges = [
      { source_file_id: 1, target_file_id: 2 },
    ];
    const { cycles } = detectCycles(edges, files);
    assert.equal(cycles.length, 0);
  });
});
