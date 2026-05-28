import { readFileSync } from 'node:fs';

export function runDeps(db, { rulesFile = null, json = false } = {}) {
  const edges = db.getAllDependencyEdges();
  const allFiles = db.getAllFiles();
  const { cycles } = detectCycles(edges, allFiles);

  let ruleViolations = [];
  let rules = [];
  if (rulesFile) {
    rules = loadRules(rulesFile);
    const edgesWithPaths = db.getAllDependencyEdgesWithPaths();
    ruleViolations = checkRules(edgesWithPaths, rules);
  }

  const hasIssues = cycles.length > 0 || ruleViolations.length > 0;

  if (json) {
    return {
      output: JSON.stringify({
        cycles: cycles.map(c => ({ files: c, size: c.length })),
        rule_violations: ruleViolations,
        cycle_count: cycles.length,
        violation_count: ruleViolations.length,
      }, null, 2),
      hasIssues,
    };
  }

  const lines = [];

  if (cycles.length > 0) {
    lines.push('Circular dependencies:');
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      const chain = [...c, c[0]].join(' -> ');
      lines.push(`  [cycle-${i + 1}] ${chain} (${c.length} files)`);
    }
  } else {
    lines.push('No circular dependencies found.');
  }

  if (ruleViolations.length > 0) {
    lines.push('');
    lines.push('Rule violations:');
    for (let i = 0; i < ruleViolations.length; i++) {
      const v = ruleViolations[i];
      lines.push(`  [${v.rule}] ${v.from} -> ${v.to}`);
      lines.push(`    ${v.message}`);
    }
  }

  lines.push('');
  lines.push(`Summary: ${cycles.length} cycles, ${ruleViolations.length} rule violations`);

  return { output: lines.join('\n'), hasIssues };
}

export function detectCycles(edges, allFiles) {
  const fileMap = new Map();
  for (const f of allFiles) fileMap.set(f.id, f.path);

  const adj = new Map();
  for (const { source_file_id, target_file_id } of edges) {
    if (!adj.has(source_file_id)) adj.set(source_file_id, []);
    adj.get(source_file_id).push(target_file_id);
  }

  const sccs = tarjan(adj, [...fileMap.keys()]);
  const cycles = sccs
    .filter(scc => scc.length > 1)
    .map(scc => scc.map(id => fileMap.get(id)).filter(Boolean).sort());

  return { cycles };
}

function tarjan(adj, nodes) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const result = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) || [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  }

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v);
  }

  return result;
}

function loadRules(filePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse rules file ${filePath}: ${e.message}`);
  }

  if (!raw.rules || !Array.isArray(raw.rules)) {
    throw new Error(`Rules file ${filePath}: missing or invalid "rules" array.`);
  }

  return raw.rules;
}

function checkRules(edgesWithPaths, rules) {
  const violations = [];

  const forbidRules = rules.filter(r => r.type === 'forbid');

  for (const edge of edgesWithPaths) {
    for (const rule of forbidRules) {
      const fromPattern = rule.from?.pathPattern;
      const toPattern = rule.to?.pathPattern;
      if (!fromPattern || !toPattern) continue;

      const fromMatch = new RegExp(fromPattern).test(edge.source_path);
      const toMatch = new RegExp(toPattern).test(edge.target_path);

      if (fromMatch && toMatch) {
        violations.push({
          rule: rule.name || 'unnamed',
          from: edge.source_path,
          to: edge.target_path,
          message: rule.message || `Forbidden: ${fromPattern} -> ${toPattern}`,
          severity: rule.severity || 'error',
        });
      }
    }
  }

  return violations;
}
