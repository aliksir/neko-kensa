// 構造的コード品質チェック（大規模ファイル/高ファンアウト/循環継承等、Biome 相当）
import { readFileSync } from 'node:fs';

// 各チェック項目のデフォルト閾値（ルールファイルで上書き可能）
const DEFAULTS = {
  'large-file': { max: 300 },
  'high-fan-out': { max: 15 },
  'high-fan-in': { max: 20 },
  'deep-inheritance': { max: 5 },
  'many-symbols': { max: 30 },
};

export function runLint(db, { rulesFile = null, json = false } = {}) {
  // ルールファイルがあれば lint セクションで閾値を上書きする
  const config = { ...DEFAULTS };
  if (rulesFile) {
    try {
      const raw = JSON.parse(readFileSync(rulesFile, 'utf8'));
      if (raw.lint) {
        for (const [key, val] of Object.entries(raw.lint)) {
          if (config[key] && typeof val.max === 'number') {
            config[key] = { ...config[key], ...val };
          }
        }
      }
    } catch {}
  }

  const findings = [];

  for (const f of db.getLargeFiles(config['large-file'].max)) {
    findings.push({ rule: 'large-file', path: f.path, detail: `${f.line_count} lines (max: ${config['large-file'].max})`, severity: 'warning' });
  }

  for (const f of db.getHighFanOut(config['high-fan-out'].max)) {
    findings.push({ rule: 'high-fan-out', path: f.path, detail: `${f.import_count} imports (max: ${config['high-fan-out'].max})`, severity: 'warning' });
  }

  for (const f of db.getHighFanIn(config['high-fan-in'].max)) {
    findings.push({ rule: 'high-fan-in', path: f.path, detail: `${f.dependent_count} dependents (max: ${config['high-fan-in'].max})`, severity: 'warning' });
  }

  for (const f of db.getUnresolvedImports()) {
    findings.push({ rule: 'unresolved-import', path: f.source_path, detail: `cannot resolve "${f.target_module}"`, severity: 'error' });
  }

  const deepChains = findDeepInheritance(db.getInheritanceChains(), config['deep-inheritance'].max);
  for (const c of deepChains) {
    findings.push({ rule: 'deep-inheritance', path: c.class, detail: `depth ${c.depth} (max: ${config['deep-inheritance'].max}): ${c.chain.join(' -> ')}`, severity: 'warning' });
  }

  for (const f of db.getManySymbols(config['many-symbols'].max)) {
    findings.push({ rule: 'many-symbols', path: f.path, detail: `${f.symbol_count} symbols (max: ${config['many-symbols'].max})`, severity: 'warning' });
  }

  const hasIssues = findings.length > 0;

  if (json) {
    return {
      output: JSON.stringify({ findings, count: findings.length, config }, null, 2),
      hasIssues,
    };
  }

  if (!hasIssues) {
    return { output: 'No lint issues found.', hasIssues: false };
  }

  const grouped = {};
  for (const f of findings) {
    if (!grouped[f.rule]) grouped[f.rule] = [];
    grouped[f.rule].push(f);
  }

  const lines = [];
  for (const [rule, items] of Object.entries(grouped)) {
    lines.push(`[${rule}] (${items.length} issues)`);
    for (const item of items) {
      const icon = item.severity === 'error' ? 'E' : 'W';
      lines.push(`  ${icon} ${item.path}: ${item.detail}`);
    }
    lines.push('');
  }

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  lines.push(`Summary: ${findings.length} issues (${errors} errors, ${warnings} warnings)`);

  return { output: lines.join('\n'), hasIssues };
}

// 継承チェーンを辿って最大深さが maxDepth を超えるクラスを抽出する
function findDeepInheritance(chains, maxDepth) {
  const parentMap = new Map();
  for (const { child_class, parent_class } of chains) {
    if (!parentMap.has(child_class)) parentMap.set(child_class, []);
    parentMap.get(child_class).push(parent_class);
  }

  const results = [];
  const allClasses = new Set([...parentMap.keys()]);

  for (const cls of allClasses) {
    const { depth, chain } = getDepth(cls, parentMap, new Set());
    if (depth > maxDepth) {
      results.push({ class: cls, depth, chain });
    }
  }

  return results;
}

// 再帰的に継承の深さを計算する（循環検出のため visited セットを使用）
function getDepth(cls, parentMap, visited) {
  if (visited.has(cls)) return { depth: 0, chain: [cls + '(circular)'] };
  visited.add(cls);

  const parents = parentMap.get(cls);
  if (!parents || parents.length === 0) return { depth: 1, chain: [cls] };

  let maxDepth = 0;
  let maxChain = [cls];

  for (const p of parents) {
    const { depth, chain } = getDepth(p, parentMap, new Set(visited));
    if (depth + 1 > maxDepth) {
      maxDepth = depth + 1;
      maxChain = [cls, ...chain];
    }
  }

  return { depth: maxDepth, chain: maxChain };
}
