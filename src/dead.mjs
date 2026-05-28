import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function runDead(db, { entries = [], repoPath = null, json = false } = {}) {
  const allFiles = db.getAllFiles();
  if (allFiles.length === 0) {
    const msg = 'No files indexed. Run code-graph index_repository first.';
    if (json) return JSON.stringify({ error: msg });
    return msg;
  }

  const edges = db.getAllDependencyEdges();
  const entryFileIds = resolveEntries(db, allFiles, entries, repoPath);

  if (entryFileIds.length === 0) {
    const msg = 'Warning: No entry points found. All files treated as reachable.';
    if (json) return JSON.stringify({ dead_files: [], total_files: allFiles.length, dead_count: 0, dead_percentage: 0, warning: msg });
    return msg;
  }

  const adjacency = buildAdjacency(edges);
  const reachable = bfs(adjacency, entryFileIds);
  const deadFiles = allFiles.filter(f => !reachable.has(f.id));

  if (json) {
    const pct = allFiles.length > 0 ? +(deadFiles.length / allFiles.length * 100).toFixed(1) : 0;
    return JSON.stringify({
      dead_files: deadFiles.map(f => ({ path: f.path, language: f.language, line_count: f.line_count })),
      total_files: allFiles.length,
      dead_count: deadFiles.length,
      dead_percentage: pct,
      entry_points: entryFileIds.length,
    }, null, 2);
  }

  if (deadFiles.length === 0) {
    return `No dead files found (${allFiles.length} files, ${entryFileIds.length} entry points).`;
  }

  const lines = ['Dead files (unreachable from entry points):'];
  for (const f of deadFiles.sort((a, b) => a.path.localeCompare(b.path))) {
    lines.push(`  ${f.path} (${f.language}, ${f.line_count} lines)`);
  }
  const pct = (deadFiles.length / allFiles.length * 100).toFixed(1);
  lines.push('');
  lines.push(`Summary: ${deadFiles.length} dead files / ${allFiles.length} total (${pct}%)`);
  return lines.join('\n');
}

function resolveEntries(db, allFiles, entries, repoPath) {
  if (entries.length > 0) {
    const ids = [];
    for (const e of entries) {
      const normalized = e.replace(/\\/g, '/');
      const f = db.getFileByPath(normalized);
      if (f) ids.push(f.id);
    }
    return ids;
  }

  if (repoPath) {
    const found = detectFromPackageJson(db, repoPath);
    if (found.length > 0) return found;
  }

  process.stderr.write('Warning: No entry points detected. Using all files as entry (dead detection disabled).\n');
  return allFiles.map(f => f.id);
}

function detectFromPackageJson(db, repoPath) {
  const pkgPath = join(resolve(repoPath), 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return [];
  }

  const candidates = [];

  if (typeof pkg.main === 'string') candidates.push(pkg.main);

  if (pkg.bin) {
    if (typeof pkg.bin === 'string') {
      candidates.push(pkg.bin);
    } else if (typeof pkg.bin === 'object') {
      candidates.push(...Object.values(pkg.bin));
    }
  }

  if (pkg.exports) {
    extractExports(pkg.exports, candidates);
  }

  const ids = [];
  for (const c of candidates) {
    const normalized = c.replace(/^\.\//, '').replace(/\\/g, '/');
    const f = db.getFileByPath(normalized);
    if (f) ids.push(f.id);
  }
  return ids;
}

function extractExports(exports, out) {
  if (typeof exports === 'string') {
    out.push(exports);
    return;
  }
  if (typeof exports !== 'object' || exports === null) return;

  if (exports['.']) extractExports(exports['.'], out);
  if (exports['default']) extractExports(exports['default'], out);

  for (const [key, val] of Object.entries(exports)) {
    if (key.startsWith('./') && typeof val === 'string') {
      out.push(val);
    }
  }
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const { source_file_id, target_file_id } of edges) {
    if (!adj.has(source_file_id)) adj.set(source_file_id, []);
    adj.get(source_file_id).push(target_file_id);
  }
  return adj;
}

function bfs(adjacency, startIds) {
  const visited = new Set(startIds);
  const queue = [...startIds];
  let i = 0;
  while (i < queue.length) {
    const current = queue[i++];
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited;
}
