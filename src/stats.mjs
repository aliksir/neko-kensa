import { detectCycles } from './deps.mjs';

export function runStats(db, { json = false } = {}) {
  const stats = db.getStats();
  const edges = db.getAllDependencyEdges();
  const files = db.getAllFiles();
  const { cycles } = detectCycles(edges, files);
  const repoPath = db.getRepositoryPath() || '(unknown)';

  if (json) {
    return JSON.stringify({
      repository: repoPath,
      ...stats,
      circular_dependencies: cycles.length,
    }, null, 2);
  }

  const lines = [
    `Repository: ${repoPath}`,
    `Files: ${stats.files.toLocaleString()}`,
    `Symbols: ${stats.symbols.toLocaleString()}`,
    `Dependencies: ${stats.dependencies.toLocaleString()}`,
    `Circular dependencies: ${cycles.length}`,
    '',
    'By language:',
  ];

  const sorted = Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]);
  const maxName = Math.max(...sorted.map(([k]) => k.length));
  for (const [lang, count] of sorted) {
    lines.push(`  ${lang.padEnd(maxName)}  ${count} files`);
  }

  return lines.join('\n');
}
