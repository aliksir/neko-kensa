#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { KensaDB } from './db.mjs';
import { runDead } from './dead.mjs';
import { runDeps } from './deps.mjs';
import { runStats } from './stats.mjs';
import { runGraph } from './graph.mjs';
import { runLint } from './lint.mjs';

const USAGE = `neko-kensa v0.3.0 - Code quality inspector (zero dependencies)

Usage:
  neko-kensa dead  [path] [--entry <file>...]  [--json] [--db <path>]
  neko-kensa deps  [path] [--rules <file>]     [--json] [--db <path>]
  neko-kensa stats                             [--json] [--db <path>]
  neko-kensa graph <type> [--out <file>] [--dir]        [--db <path>]
  neko-kensa lint  [--rules <file>]                    [--json] [--db <path>]
  neko-kensa --help

Commands:
  dead    Detect unreachable files from entry points (Knip-like)
  deps    Detect circular dependencies and rule violations (dependency-cruiser-like)
  stats   Show repository statistics
  graph   Generate dependency/class/call graph as HTML (Astah-like)
  lint    Structural code quality checks (Biome-like)

Graph types:
  deps    File/directory dependency graph
  class   Class inheritance hierarchy
  calls   Function call graph

Options:
  --entry <file>   Specify entry point files (dead only, repeatable)
  --rules <file>   Path to rules file (deps only, default: .neko-kensa.json)
  --json           Output as JSON
  --out <file>     Write HTML to file instead of stdout (graph only)
  --dir            Aggregate by directory (graph deps only)
  --db <path>      Path to graph.db (default: ~/.code-graph/graph.db)
  --help           Show this help
`;

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const command = args[0];
  const flags = parseFlags(args.slice(1));

  const db = new KensaDB(flags.db || null);
  try {
    db.open();
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'dead': {
        const repoPath = flags._positional[0] || db.getRepositoryPath() || '.';
        const { output, hasIssues } = runDead(db, {
          entries: flags.entry || [],
          repoPath,
          json: flags.json,
        });
        process.stdout.write(output + '\n');
        if (hasIssues) process.exit(1);
        break;
      }
      case 'deps': {
        const rulesFile = flags.rules || findDefaultRules(flags._positional[0]);
        const { output, hasIssues } = runDeps(db, {
          rulesFile,
          json: flags.json,
        });
        process.stdout.write(output + '\n');
        if (hasIssues) process.exit(1);
        break;
      }
      case 'stats': {
        const output = runStats(db, { json: flags.json });
        process.stdout.write(output + '\n');
        break;
      }
      case 'graph': {
        const graphType = flags._positional[0] || 'deps';
        const html = runGraph(db, { type: graphType, dir: flags.dir });
        if (flags.out) {
          writeFileSync(flags.out, html, 'utf8');
          process.stderr.write(`Graph written to ${flags.out}\n`);
        } else {
          process.stdout.write(html);
        }
        break;
      }
      case 'lint': {
        const rulesFile = flags.rules || findDefaultRules(flags._positional[0]);
        const { output, hasIssues } = runLint(db, {
          rulesFile,
          json: flags.json,
        });
        process.stdout.write(output + '\n');
        if (hasIssues) process.exit(1);
        break;
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n\n`);
        process.stdout.write(USAGE);
        process.exit(1);
    }
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function parseFlags(args) {
  const flags = { _positional: [], entry: [] };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--db' && i + 1 < args.length) {
      flags.db = args[++i];
    } else if (arg === '--entry' && i + 1 < args.length) {
      flags.entry.push(args[++i]);
    } else if (arg === '--rules' && i + 1 < args.length) {
      flags.rules = args[++i];
    } else if (arg === '--out' && i + 1 < args.length) {
      flags.out = args[++i];
    } else if (arg === '--dir') {
      flags.dir = true;
    } else if (!arg.startsWith('-')) {
      flags._positional.push(arg);
    }
    i++;
  }
  return flags;
}

function findDefaultRules(basePath) {
  const base = resolve(basePath || '.');
  const candidate = join(base, '.neko-kensa.json');
  return existsSync(candidate) ? candidate : null;
}

main();
