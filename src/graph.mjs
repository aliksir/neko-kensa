import { dirname } from 'node:path';

export function runGraph(db, { type = 'deps', dir = false } = {}) {
  switch (type) {
    case 'deps': return generateDepsGraph(db, dir);
    case 'class': return generateClassGraph(db);
    case 'calls': return generateCallsGraph(db);
    default: throw new Error(`Unknown graph type: ${type}. Use deps, class, or calls.`);
  }
}

function generateDepsGraph(db, dirMode) {
  const edges = db.getAllDependencyEdgesWithPaths();
  if (edges.length === 0) return emptyHTML('deps', 'No dependency data found.');

  const nodeSet = new Set();
  const graphEdges = [];

  if (dirMode) {
    const dirEdges = new Map();
    for (const { source_path, target_path } of edges) {
      const s = dirname(source_path);
      const t = dirname(target_path);
      if (s === t) continue;
      const key = `${s}|${t}`;
      dirEdges.set(key, (dirEdges.get(key) || 0) + 1);
      nodeSet.add(s);
      nodeSet.add(t);
    }
    for (const [key, weight] of dirEdges) {
      const [s, t] = key.split('|');
      graphEdges.push({ source: s, target: t, weight });
    }
  } else {
    for (const { source_path, target_path } of edges) {
      nodeSet.add(source_path);
      nodeSet.add(target_path);
      graphEdges.push({ source: source_path, target: target_path, weight: 1 });
    }
  }

  const nodes = [...nodeSet].map(id => ({
    id,
    label: id.split('/').pop(),
    group: dirname(id),
  }));

  return renderHTML('Dependency Graph', nodes, graphEdges, 'deps');
}

function generateClassGraph(db) {
  const rows = db.getAllInheritanceWithPaths();
  if (rows.length === 0) return emptyHTML('class', 'No inheritance data found.');

  const nodeSet = new Map();
  const edges = [];

  for (const { child_path, child_class, parent_class, parent_path } of rows) {
    const childId = `${child_class}`;
    const parentId = `${parent_class}`;
    if (!nodeSet.has(childId)) nodeSet.set(childId, { id: childId, label: child_class, group: child_path || '' });
    if (!nodeSet.has(parentId)) nodeSet.set(parentId, { id: parentId, label: parent_class, group: parent_path || '' });
    edges.push({ source: parentId, target: childId, weight: 1 });
  }

  return renderHTML('Class Hierarchy', [...nodeSet.values()], edges, 'class');
}

function generateCallsGraph(db) {
  const rows = db.getAllCallsWithPaths();
  if (rows.length === 0) return emptyHTML('calls', 'No call data found.');

  const nodeSet = new Map();
  const edgeSet = new Map();

  for (const { caller_path, caller_symbol, callee_name, callee_path } of rows) {
    const callerId = caller_symbol ? `${caller_symbol}` : `${caller_path}`;
    const calleeId = callee_name;

    if (!nodeSet.has(callerId)) nodeSet.set(callerId, { id: callerId, label: callerId.split('/').pop(), group: caller_path || '' });
    if (!nodeSet.has(calleeId)) nodeSet.set(calleeId, { id: calleeId, label: calleeId, group: callee_path || '' });

    const key = `${callerId}|${calleeId}`;
    edgeSet.set(key, (edgeSet.get(key) || 0) + 1);
  }

  const edges = [];
  for (const [key, weight] of edgeSet) {
    const [s, t] = key.split('|');
    edges.push({ source: s, target: t, weight });
  }

  return renderHTML('Call Graph', [...nodeSet.values()], edges, 'calls');
}

function emptyHTML(type, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>neko-kensa graph (${type})</title>
<style>body{background:#1a1a2e;color:#e0e0e0;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.msg{text-align:center;font-size:1.5rem;opacity:0.7}</style>
</head><body><div class="msg">${message}</div></body></html>`;
}

const COLORS = [
  '#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7',
  '#dda0dd','#98d8c8','#f7dc6f','#bb8fce','#85c1e9',
  '#f8c471','#82e0aa','#f1948a','#aed6f1','#d7bde2',
];

function renderHTML(title, nodes, edges, type) {
  const data = JSON.stringify({ nodes, edges, type });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>neko-kensa: ${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a2e;color:#e0e0e0;font-family:system-ui;overflow:hidden}
#header{position:fixed;top:0;left:0;right:0;padding:12px 20px;background:rgba(26,26,46,0.95);z-index:10;display:flex;align-items:center;gap:16px;border-bottom:1px solid #333}
#header h1{font-size:1rem;font-weight:600;color:#4ecdc4}
#header .stats{font-size:0.8rem;color:#888}
#info{position:fixed;bottom:12px;left:12px;font-size:0.75rem;color:#666;z-index:10}
canvas{display:block;cursor:grab}
canvas:active{cursor:grabbing}
#tooltip{position:fixed;display:none;background:#16213e;border:1px solid #4ecdc4;padding:8px 12px;border-radius:6px;font-size:0.8rem;pointer-events:none;z-index:20;max-width:400px;word-break:break-all}
</style>
</head>
<body>
<div id="header">
  <h1>${title}</h1>
  <span class="stats" id="stats"></span>
</div>
<canvas id="graph"></canvas>
<div id="tooltip"></div>
<div id="info">Drag to pan | Scroll to zoom | Hover for details</div>
<script>
const DATA = ${data};
const COLORS = ${JSON.stringify(COLORS)};

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');

let W, H;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', () => { resize(); draw(); });

document.getElementById('stats').textContent = DATA.nodes.length + ' nodes, ' + DATA.edges.length + ' edges';

const groupColors = new Map();
let ci = 0;
for (const n of DATA.nodes) {
  if (!groupColors.has(n.group)) groupColors.set(n.group, COLORS[ci++ % COLORS.length]);
}

const nodeMap = new Map();
for (const n of DATA.nodes) {
  n.x = W/2 + (Math.random() - 0.5) * Math.min(W, H) * 0.6;
  n.y = H/2 + (Math.random() - 0.5) * Math.min(W, H) * 0.6;
  n.vx = 0; n.vy = 0;
  n.color = groupColors.get(n.group);
  n.radius = Math.max(4, Math.min(12, 4 + Math.sqrt(n.label.length)));
  nodeMap.set(n.id, n);
}

const resolvedEdges = DATA.edges.map(e => ({
  source: nodeMap.get(e.source),
  target: nodeMap.get(e.target),
  weight: e.weight || 1,
})).filter(e => e.source && e.target);

let camX = 0, camY = 0, zoom = 1;
let dragging = false, dragX = 0, dragY = 0;
let hovered = null;

canvas.addEventListener('mousedown', e => { dragging = true; dragX = e.clientX; dragY = e.clientY; });
canvas.addEventListener('mousemove', e => {
  if (dragging) {
    camX += e.clientX - dragX; camY += e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    draw();
  } else {
    const mx = (e.clientX - camX) / zoom;
    const my = (e.clientY - camY) / zoom;
    let found = null;
    for (const n of DATA.nodes) {
      const dx = n.x - mx, dy = n.y - my;
      if (dx*dx + dy*dy < (n.radius+4)*(n.radius+4)) { found = n; break; }
    }
    if (found !== hovered) {
      hovered = found;
      if (hovered) {
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
        tooltip.innerHTML = '<b>' + hovered.id + '</b><br><span style="color:#888">' + hovered.group + '</span>';
      } else {
        tooltip.style.display = 'none';
      }
      draw();
    }
    if (hovered) {
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY + 12) + 'px';
    }
  }
});
canvas.addEventListener('mouseup', () => { dragging = false; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const mx = e.clientX, my = e.clientY;
  camX = mx - (mx - camX) * factor;
  camY = my - (my - camY) * factor;
  zoom *= factor;
  draw();
}, { passive: false });

const ITERATIONS = 300;
const REPULSION = 800;
const ATTRACTION = 0.005;
const DAMPING = 0.9;
const DT = 0.3;
const nodes = DATA.nodes;

function simulate() {
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const n of nodes) { n.fx = 0; n.fy = 0; }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = dx / dist * force, fy = dy / dist * force;
        a.fx -= fx; a.fy -= fy;
        b.fx += fx; b.fy += fy;
      }
    }

    for (const e of resolvedEdges) {
      let dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
      let dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const force = (dist - 100) * ATTRACTION * e.weight;
      const fx = dx / dist * force, fy = dy / dist * force;
      e.source.fx += fx; e.source.fy += fy;
      e.target.fx -= fx; e.target.fy -= fy;
    }

    for (const n of nodes) {
      n.vx = (n.vx + n.fx * DT) * DAMPING;
      n.vy = (n.vy + n.fy * DT) * DAMPING;
      n.x += n.vx; n.y += n.vy;
    }
  }
}

if (nodes.length <= 500) simulate();
else {
  const step = Math.ceil(nodes.length / 500);
  for (let i = 0; i < nodes.length; i++) {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = 200 + (i % step) * 30;
    nodes[i].x = W/2 + Math.cos(angle) * r;
    nodes[i].y = H/2 + Math.sin(angle) * r;
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(camX, camY);
  ctx.scale(zoom, zoom);

  ctx.lineWidth = 0.5;
  for (const e of resolvedEdges) {
    const isHL = hovered && (e.source === hovered || e.target === hovered);
    ctx.strokeStyle = isHL ? '#4ecdc4' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = isHL ? 1.5 : 0.5;
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();

    if (isHL) {
      const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
      const len = Math.sqrt(dx*dx+dy*dy) || 1;
      const ux = dx/len, uy = dy/len;
      const ax = e.target.x - ux * e.target.radius * 1.5;
      const ay = e.target.y - uy * e.target.radius * 1.5;
      ctx.fillStyle = '#4ecdc4';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - ux*8 + uy*4, ay - uy*8 - ux*4);
      ctx.lineTo(ax - ux*8 - uy*4, ay - uy*8 + ux*4);
      ctx.fill();
    }
  }

  for (const n of nodes) {
    const isHL = n === hovered;
    ctx.fillStyle = isHL ? '#fff' : n.color;
    ctx.globalAlpha = isHL ? 1 : 0.8;
    ctx.beginPath();
    ctx.arc(n.x, n.y, isHL ? n.radius * 1.5 : n.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (zoom > 0.6 || isHL) {
      ctx.fillStyle = isHL ? '#4ecdc4' : 'rgba(255,255,255,0.6)';
      ctx.font = (isHL ? 'bold ' : '') + Math.max(8, 10/zoom) + 'px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + n.radius + 12);
    }
  }

  ctx.restore();
}

draw();
</script>
</body>
</html>`;
}
