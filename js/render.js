/**
 * render.js — canvas setup and all drawing routines.
 *
 * Coordinate system: world space is [−4,4]×[−4,4].
 * After ctx.scale(dpr,dpr) all draw calls use CSS/logical pixels.
 */
import { state, computed } from './state.js';
import { SET2, hexToRgb, blueColor } from './colors.js';
import {
  ANGLE_EPS,
  barycentricOptimal,
  computeBinaryRefinement,
  computeCone,
  convexHull,
  angleInInterval,
} from './math.js';

/** Return the current barycentric start point in world coords, or null. */
export function getBaryStart() {
  const { X, r, w0, withSim, withBary } = state;
  if (!withSim || !withBary) return null;
  return barycentricOptimal(X, r, w0);
}

export const canvas = document.getElementById('canvas');
export const ctx = canvas.getContext('2d');
export const graphCanvas = document.getElementById('graph-canvas');
export const graphCtx = graphCanvas.getContext('2d');

const WORLD = { min: -4, max: 4, span: 8 };
const PAD = 50;
const CELL_MIN_R = 0.22;
const CELL_OUTER_R = 4000;

let _logicalSize = 600;
let _lastInteractive = { cells: [], nodes: [], edges: [], graphRect: null };
let _lastBinary = null;
let _graphLogical = { w: 250, h: 250 };
let _binaryCache = { key: null, value: null };
let _actionConeCache = { key: null, value: null };

export function getLogicalSize() { return _logicalSize; }

export function w2c(wx, wy) {
  const s = _logicalSize;
  return [
    PAD + (wx - WORLD.min) / WORLD.span * (s - 2 * PAD),
    s - PAD - (wy - WORLD.min) / WORLD.span * (s - 2 * PAD),
  ];
}

export function c2w(cx, cy) {
  const s = _logicalSize;
  return [
    WORLD.min + (cx - PAD) / (s - 2 * PAD) * WORLD.span,
    WORLD.min + (s - PAD - cy) / (s - 2 * PAD) * WORLD.span,
  ];
}

export function resize() {
  const wrap = canvas.parentElement.getBoundingClientRect();
  const graphWidth = Math.max(300, Math.min(420, Math.floor(wrap.width * 0.3)));
  const availableMainWidth = Math.max(260, wrap.width - graphWidth - 28);
  const size = Math.floor(Math.min(availableMainWidth, wrap.height) * 0.97);
  _logicalSize = size;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  _graphLogical = { w: graphWidth, h: size };
  graphCanvas.width = graphWidth * dpr;
  graphCanvas.height = size * dpr;
  graphCanvas.style.width = graphWidth + 'px';
  graphCanvas.style.height = size + 'px';
  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let _frameRequested = false;

export function scheduleRender() {
  if (_frameRequested) return;
  _frameRequested = true;
  requestAnimationFrame(_frame);
}

function _frame() {
  _frameRequested = false;
  draw();
}

export function hitTestInteractive(cx, cy) {
  const [wx, wy] = c2w(cx, cy);
  const radius = Math.hypot(wx, wy);
  if (radius >= CELL_MIN_R) {
    const angle = Math.atan2(wy, wx);
    for (const cell of _lastInteractive.cells) {
      if (angleInInterval(angle, cell.angleStart, cell.angleEnd, ANGLE_EPS)) {
        return { type: 'cell', cellKey: cell.key };
      }
    }
  }
  return null;
}

export function hitTestGraphInteractive(cx, cy) {
  for (const node of _lastInteractive.nodes) {
    const dx = cx - node.cx;
    const dy = cy - node.cy;
    if (dx * dx + dy * dy <= node.r * node.r) return { type: 'node', cellKey: node.cellKey };
  }
  for (const edge of _lastInteractive.edges) {
    const hit = edge.selfLoop
      ? Math.abs(Math.hypot(cx - edge.cx, cy - edge.cy) - edge.loopR) < 5
      : _distanceToSegment(cx, cy, edge.x1, edge.y1, edge.x2, edge.y2) < 6;
    if (hit) return { type: 'edge', sourceKey: edge.sourceKey, targetKey: edge.targetKey };
  }
  return null;
}

function arrow(x1, y1, x2, y2, head = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const a = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
  ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
}

function star(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = -Math.PI / 2 + i * 2 * Math.PI / 5;
    const a2 = a1 + Math.PI / 5;
    i === 0
      ? ctx.moveTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1))
      : ctx.lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
    ctx.lineTo(cx + r / 2.3 * Math.cos(a2), cy + r / 2.3 * Math.sin(a2));
  }
  ctx.closePath();
}

export function draw() {
  const {
    X, r, w0, rewardMode, withField, withSim, withBary, withHull,
    withHullSub, withBarySub, withDiffCone,
  } = state;
  const sz = _logicalSize;

  ctx.clearRect(0, 0, sz, sz);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sz, sz);

  const maxR = Math.max(...r);
  const optPts = X.filter((_, i) => r[i] === maxR);
  const subIdxs = X.reduce((a, _, i) => (r[i] !== maxR ? [...a, i] : a), []);
  const subPts = X.filter((_, i) => r[i] < maxR);
  let hullVerts = [];
  let hullEdges = [];
  if (optPts.length >= 3) {
    hullVerts = convexHull(optPts);
    hullEdges = hullVerts.map((v, i) => [v, hullVerts[(i + 1) % hullVerts.length]]);
  } else if (optPts.length === 2) {
    hullVerts = optPts;
    hullEdges = [[optPts[0], optPts[1]]];
  } else if (optPts.length === 1) {
    hullVerts = optPts;
  }
  let hullSubVerts = [];
  if (subPts.length >= 3) hullSubVerts = convexHull(subPts);
  else if (subPts.length >= 1) hullSubVerts = subPts.slice();

  _lastBinary = rewardMode === 'binary' ? _getBinaryRefinement(X, r) : null;
  const cells = _visibleCells(_lastBinary);
  const cellMap = new Map(cells.map(cell => [cell.key, cell]));
  if (state.selectedCellKey && !cellMap.has(state.selectedCellKey)) state.selectedCellKey = null;
  if (state.hover?.cellKey && !cellMap.has(state.hover.cellKey)) state.hover = null;

  const focus = _resolveFocus(cellMap);
  const graphRect = _graphRect();
  _lastInteractive = { cells, nodes: [], edges: [], graphRect };

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD, PAD, sz - 2 * PAD, sz - 2 * PAD);
  ctx.clip();

  if (state.withConeBackground) _drawConeLayers(X, rewardMode, _lastBinary);
  if (rewardMode === 'binary' && state.withCells && _lastBinary?.enabled) _drawCells(cells, focus);
  if (withField && computed.field) _drawField(sz);
  if (withBary && computed.baryTraj?.length > 1) _drawBaryTraj(computed.baryTraj, '#2980b9');
  if (withBarySub && computed.barySubTraj?.length > 1) _drawBaryTraj(computed.barySubTraj, '#c0392b');
  if (withBary && withSim) _drawBaryStart(X, r, w0);
  _drawOptimalHull(X, hullVerts, hullEdges, subIdxs);
  if (withHullSub && hullSubVerts.length >= 2) _drawSubHull(hullSubVerts);
  if (withDiffCone && optPts.length >= 1 && subPts.length >= 1) _drawDiffCone(optPts, subPts);
  if (rewardMode === 'binary' && _lastBinary?.enabled) _drawDriftVectors(cells, focus);
  if (withSim && computed.traj?.length > 1) _drawTrajectory(computed.traj);
  if (withSim) _drawW0(w0);
  _drawPoints(X, r, focus);

  ctx.restore();

  _drawAxes(sz);
  if (rewardMode === 'binary' && state.withGraph && _lastBinary?.enabled) _drawGraph(cells, focus, graphRect);
  else _drawBinaryStatus(graphRect);

  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD, PAD, sz - 2 * PAD, sz - 2 * PAD);
}

function _drawConeLayers(X, rewardMode, binary) {
  if (rewardMode === 'binary' && binary?.enabled) {
    if (state.withGoodCones) _drawVertexConeSet(binary.goodVertices, { fillAlpha: 0.16, strokeAlpha: 0.46 });
    if (state.withBadCones) _drawVertexConeSet(binary.badVertices, { fillAlpha: 0.14, strokeAlpha: 0.42 });
    return;
  }
  _drawActionCones(_getActionCones(X));
}

function _drawVertexConeSet(vertices, { fillAlpha, strokeAlpha }) {
  const R = 4000;
  const [ox, oy] = w2c(0, 0);
  for (const vertex of vertices) {
    const cone = vertex.cone;
    if (!cone || cone.startAngle === undefined || cone.endAngle === undefined) continue;
    const rgb = hexToRgb(SET2[vertex.id % SET2.length]);
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${fillAlpha})`;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    for (let s = 0; s <= 180; s++) {
      const ang = cone.startAngle + (cone.endAngle - cone.startAngle) * s / 180;
      const [px, py] = w2c(R * Math.cos(ang), R * Math.sin(ang));
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${strokeAlpha})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const ray of cone.rays ?? []) {
      const [px, py] = w2c(R * ray[0], R * ray[1]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

function _drawActionCones(cones) {
  const R = 4000;
  const [ox, oy] = w2c(0, 0);
  for (let a = 0; a < cones.length; a++) {
    const cone = cones[a];
    if (!cone || cone.startAngle === undefined) continue;
    const rgb = hexToRgb(SET2[a % SET2.length]);
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.17)`;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    for (let s = 0; s <= 360; s++) {
      const ang = cone.startAngle + (cone.endAngle - cone.startAngle) * s / 360;
      const [px, py] = w2c(R * Math.cos(ang), R * Math.sin(ang));
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const ray of cone.rays) {
      const [px, py] = w2c(R * ray[0], R * ray[1]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

function _drawField(sz) {
  const sc = (sz - 2 * PAD) / WORLD.span * 0.17;
  for (const pt of computed.field) {
    if (pt.mag < 1e-12) continue;
    const un = [pt.g[0] / pt.mag, pt.g[1] / pt.mag];
    const [cx, cy] = w2c(pt.wx, pt.wy);
    const color = blueColor(pt.t);
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 1.1;
    ctx.globalAlpha = 0.85;
    arrow(cx, cy, cx + un[0] * sc, cy - un[1] * sc, 5);
    ctx.globalAlpha = 1;
  }
}

function _drawBaryTraj(traj, color) {
  const bt = traj.filter(Boolean);
  if (bt.length <= 1) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  const [bx0, by0] = w2c(...bt[0]);
  ctx.moveTo(bx0, by0);
  for (let i = 1; i < bt.length; i++) {
    const [bx, by] = w2c(...bt[i]);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const [sx, sy] = w2c(...bt[0]);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sx, sy, 4.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  const [ex, ey] = w2c(...bt[bt.length - 1]);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(ex, ey, 5.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
}

function _drawBaryStart(X, r, w0) {
  const bs = barycentricOptimal(X, r, w0);
  if (!bs) return;
  const [bx, by] = w2c(...bs);
  const d = 7;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2980b9';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(bx, by - d);
  ctx.lineTo(bx + d, by);
  ctx.lineTo(bx, by + d);
  ctx.lineTo(bx - d, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function _drawOptimalHull(X, hullVerts, hullEdges, subIdxs) {
  if (state.withHull && hullVerts.length >= 2) {
    ctx.strokeStyle = 'rgba(41,128,185,0.65)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const [hx0, hy0] = w2c(...hullVerts[0]);
    ctx.moveTo(hx0, hy0);
    for (let i = 1; i < hullVerts.length; i++) {
      const [hx, hy] = w2c(...hullVerts[i]);
      ctx.lineTo(hx, hy);
    }
    if (hullVerts.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (state.withProjections && hullEdges.length > 0 && subIdxs.length > 0) {
    for (const si of subIdxs) {
      const P = X[si];
      const color = SET2[si % SET2.length];
      const rgb = hexToRgb(color);
      const [px, py] = w2c(...P);
      for (const [A, B] of hullEdges) {
        const dw = [B[0] - A[0], B[1] - A[1]];
        const len2 = dw[0] * dw[0] + dw[1] * dw[1];
        if (len2 < 1e-20) continue;
        const t = ((P[0] - A[0]) * dw[0] + (P[1] - A[1]) * dw[1]) / len2;
        const proj = [A[0] + t * dw[0], A[1] + t * dw[1]];
        const [qx, qy] = w2c(...proj);
        const cpLen = Math.hypot(px - qx, py - qy);
        if (cpLen < 0.5) continue;

        if (t < 0 || t > 1) {
          const [nx, ny] = w2c(...(t < 0 ? A : B));
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.30)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(qx, qy);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
        ctx.setLineDash([]);

        const [ax, ay] = w2c(...A);
        const [bx, by] = w2c(...B);
        const ceLen = Math.hypot(bx - ax, by - ay);
        if (ceLen < 0.5) continue;
        const ce = [(bx - ax) / ceLen, (by - ay) / ceLen];
        const cp = [(px - qx) / cpLen, (py - qy) / cpLen];
        const m = 6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(qx + ce[0] * m, qy + ce[1] * m);
        ctx.lineTo(qx + ce[0] * m + cp[0] * m, qy + ce[1] * m + cp[1] * m);
        ctx.lineTo(qx + cp[0] * m, qy + cp[1] * m);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(qx, qy, 3.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function _drawSubHull(hullSubVerts) {
  ctx.strokeStyle = 'rgba(192,57,43,0.65)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  const [hx0, hy0] = w2c(...hullSubVerts[0]);
  ctx.moveTo(hx0, hy0);
  for (let i = 1; i < hullSubVerts.length; i++) {
    const [hx, hy] = w2c(...hullSubVerts[i]);
    ctx.lineTo(hx, hy);
  }
  if (hullSubVerts.length >= 3) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

function _drawDiffCone(optPts, subPts) {
  const dirs = [];
  for (const p of optPts) for (const q of subPts) {
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;
    dirs.push({ d: [dx / len, dy / len], a: Math.atan2(dy, dx) });
  }
  if (!dirs.length) return;
  dirs.sort((u, v) => u.a - v.a);
  const m = dirs.length;
  let maxGap = 0;
  let gapIdx = m - 1;
  for (let i = 0; i < m; i++) {
    const gap = i < m - 1 ? dirs[i + 1].a - dirs[i].a : dirs[0].a + 2 * Math.PI - dirs[m - 1].a;
    if (gap > maxGap) { maxGap = gap; gapIdx = i; }
  }
  const rays = [dirs[gapIdx].d, dirs[(gapIdx + 1) % m].d];
  const [ox, oy] = w2c(0, 0);
  ctx.strokeStyle = 'rgba(142,68,173,0.75)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 3]);
  for (const ray of rays) {
    const [px, py] = w2c(ray[0] * 9, ray[1] * 9);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(px, py);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function _drawDriftVectors(cells, focus) {
  if (state.driftMode === 'none') return;
  const chosen = state.driftMode === 'all'
    ? cells
    : cells.filter(cell => cell.key === focus.sourceKey || cell.key === focus.edgeSourceKey);
  const [ox, oy] = w2c(0, 0);
  for (const cell of chosen) {
    const color = _classificationColor(cell.classification);
    const alpha = cell.key === focus.sourceKey ? 0.95 : 0.55;
    ctx.strokeStyle = _rgba(color, alpha);
    ctx.fillStyle = _rgba(color, alpha);
    ctx.lineWidth = cell.key === focus.sourceKey ? 2.4 : 1.4;
    const [dx, dy] = w2c(cell.driftVector[0], cell.driftVector[1]);
    arrow(ox, oy, dx, dy, cell.key === focus.sourceKey ? 8 : 6);
  }
}

function _drawTrajectory(traj) {
  ctx.strokeStyle = '#2c2c2c';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  const [x0, y0] = w2c(...traj[0]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < traj.length; i++) {
    const [xi, yi] = w2c(...traj[i]);
    ctx.lineTo(xi, yi);
  }
  ctx.stroke();
  const wT = traj[traj.length - 1];
  if (isFinite(wT[0])) {
    const [ex, ey] = w2c(...wT);
    ctx.fillStyle = '#2c2c2c';
    star(ex, ey, 8);
    ctx.fill();
  }
}

function _drawW0(w0) {
  const [sx, sy] = w2c(w0[0], w0[1]);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(sx, sy, 6.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
}

function _drawPoints(X, r, focus) {
  const active = new Set();
  const secondary = new Set();
  if (focus.sourceCell) {
    active.add(focus.sourceCell.goodVertexId);
    active.add(focus.sourceCell.badVertexId);
  }
  if (focus.targetCell) {
    secondary.add(focus.targetCell.goodVertexId);
    secondary.add(focus.targetCell.badVertexId);
  }

  for (let k = 0; k < X.length; k++) {
    const [px, py] = w2c(X[k][0], X[k][1]);
    if (secondary.has(k)) {
      ctx.fillStyle = 'rgba(241,196,15,0.18)';
      ctx.beginPath();
      ctx.arc(px, py, 13.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (active.has(k)) {
      ctx.fillStyle = 'rgba(46,204,113,0.18)';
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = SET2[k % SET2.length];
    ctx.strokeStyle = '#444';
    ctx.lineWidth = active.has(k) ? 2 : 0.9;
    ctx.beginPath();
    ctx.arc(px, py, 7.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'italic 13px Georgia,serif';
    ctx.textAlign = 'left';
    ctx.fillText(`x\u2080`.replace('\u2080', _sub(k + 1)), px + 11, py - 3);
    ctx.fillStyle = '#777';
    ctx.font = '10.5px monospace';
    const rewardLabel = state.rewardMode === 'binary' ? (r[k] > 0.5 ? 'good' : 'bad') : `r=${_fmt(r[k])}`;
    ctx.fillText(rewardLabel, px + 11, py + 10);
  }
}

function _drawAxes(sz) {
  const [ax0, ay0] = w2c(0, WORLD.min);
  const [ax1, ay1] = w2c(0, WORLD.max);
  const [bx0, by0] = w2c(WORLD.min, 0);
  const [bx1, by1] = w2c(WORLD.max, 0);
  ctx.strokeStyle = '#b8b8b8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(ax0, ay0);
  ctx.lineTo(ax1, ay1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx0, by0);
  ctx.lineTo(bx1, by1);
  ctx.stroke();

  ctx.fillStyle = '#999';
  ctx.font = '10px sans-serif';
  for (let v = -4; v <= 4; v += 2) {
    if (!v) continue;
    const [tx, ty] = w2c(v, 0);
    ctx.textAlign = 'center';
    ctx.fillText(v, tx, ty + 15);
    const [tx2, ty2] = w2c(0, v);
    ctx.textAlign = 'right';
    ctx.fillText(v, tx2 - 5, ty2 + 4);
  }

  ctx.fillStyle = '#555';
  ctx.font = 'italic 13px Georgia,serif';
  ctx.textAlign = 'center';
  ctx.fillText('w\u2081', sz / 2, sz - 9);
  ctx.save();
  ctx.translate(15, sz / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('w\u2082', 0, 0);
  ctx.restore();
}

function _drawCells(cells, focus) {
  const [ox, oy] = w2c(0, 0);
  for (const cell of cells) {
    const fill = _cellColor(cell);
    const active = cell.key === focus.sourceKey || cell.key === focus.targetKey;
    ctx.beginPath();
    _arcPath(ox, oy, 0, CELL_OUTER_R, cell.angleStart, cell.angleEnd);
    ctx.fillStyle = _rgba(fill, active ? 0.48 : 0.30);
    ctx.fill();
    ctx.strokeStyle = _rgba(_classificationColor(cell.classification), active ? 0.95 : 0.6);
    ctx.lineWidth = active ? 2.4 : (cell.classification === 'trap' ? 1.8 : 1.2);
    if (cell.ambiguous || cell.isDegenerate) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    const labelR = active ? 3.2 : 2.85;
    const [lx, ly] = w2c(labelR * Math.cos(cell.angleMid), labelR * Math.sin(cell.angleMid));
    ctx.fillStyle = '#233';
    ctx.font = active ? 'bold 12px monospace' : '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`(${cell.goodVertexId + 1},${cell.badVertexId + 1})`, lx, ly);
  }
  _lastInteractive.cells = cells;
}

function _drawGraph(cells, focus, rect) {
  graphCtx.clearRect(0, 0, _graphLogical.w, _graphLogical.h);
  graphCtx.fillStyle = '#fff';
  graphCtx.fillRect(0, 0, _graphLogical.w, _graphLogical.h);
  graphCtx.fillStyle = 'rgba(250,250,250,0.96)';
  graphCtx.strokeStyle = '#d6d6d6';
  graphCtx.lineWidth = 1;
  _roundRectOn(graphCtx, rect.x, rect.y, rect.w, rect.h, 10);
  graphCtx.fill();
  graphCtx.stroke();

  graphCtx.fillStyle = '#555';
  graphCtx.font = 'italic 14px Georgia,serif';
  graphCtx.textAlign = 'left';
  graphCtx.fillText('Cell Graph', rect.x + 16, rect.y + 24);

  const goodOrder = _lastBinary.goodVertices.map(v => v.id);
  const badOrder = _lastBinary.badVertices.map(v => v.id);
  const left = rect.x + 44;
  const right = rect.x + rect.w - 28;
  const top = rect.y + 62;
  const bottom = rect.y + rect.h - 86;
  const xStep = badOrder.length > 1 ? (right - left) / (badOrder.length - 1) : 0;
  const yStep = goodOrder.length > 1 ? (bottom - top) / (goodOrder.length - 1) : 0;
  const positions = new Map();

  graphCtx.fillStyle = '#999';
  graphCtx.font = '11px monospace';
  badOrder.forEach((id, i) => graphCtx.fillText(`b${id + 1}`, left + i * xStep - 10, top - 18));
  goodOrder.forEach((id, i) => graphCtx.fillText(`g${id + 1}`, rect.x + 12, top + i * yStep + 4));

  const nodes = [];
  const edges = [];
  for (const cell of cells) {
    const gx = badOrder.indexOf(cell.badVertexId);
    const gy = goodOrder.indexOf(cell.goodVertexId);
    const cx = left + gx * xStep;
    const cy = top + gy * yStep;
    positions.set(cell.key, { cx, cy });
  }

  const edgeCells = state.withSelectedEdgeOnly && focus.edgeSourceKey
    ? cells.filter(cell => cell.key === focus.edgeSourceKey)
    : state.withSelectedEdgeOnly && focus.sourceKey
      ? cells.filter(cell => cell.key === focus.sourceKey)
      : cells;

  for (const cell of edgeCells) {
    const src = positions.get(cell.key);
    if (!src || !cell.targetCellKey || !positions.has(cell.targetCellKey)) continue;
    const dst = positions.get(cell.targetCellKey);
    const active = cell.key === focus.edgeSourceKey || cell.key === focus.sourceKey;
    graphCtx.strokeStyle = _rgba(_classificationColor(cell.classification), active ? 0.95 : 0.55);
    graphCtx.fillStyle = _rgba(_classificationColor(cell.classification), active ? 0.95 : 0.55);
    graphCtx.lineWidth = active ? 2.3 : 1.2;
    if (cell.ambiguous) graphCtx.setLineDash([4, 4]);
    if (cell.key === cell.targetCellKey) {
      graphCtx.beginPath();
      graphCtx.arc(src.cx, src.cy - 14, 12, 0.3 * Math.PI, 2.45 * Math.PI);
      graphCtx.stroke();
      _arrowOn(graphCtx, src.cx + 10, src.cy - 22, src.cx + 9.5, src.cy - 22, 6);
      edges.push({ selfLoop: true, cx: src.cx, cy: src.cy - 14, loopR: 12, sourceKey: cell.key, targetKey: cell.targetCellKey });
    } else {
      const dx = dst.cx - src.cx;
      const dy = dst.cy - src.cy;
      const len = Math.hypot(dx, dy) || 1;
      const sx = src.cx + (dx / len) * 14;
      const sy = src.cy + (dy / len) * 14;
      const tx = dst.cx - (dx / len) * 14;
      const ty = dst.cy - (dy / len) * 14;
      _arrowOn(graphCtx, sx, sy, tx, ty, active ? 8 : 6);
      edges.push({ x1: sx, y1: sy, x2: tx, y2: ty, sourceKey: cell.key, targetKey: cell.targetCellKey });
    }
    graphCtx.setLineDash([]);
  }

  for (const cell of cells) {
    const pos = positions.get(cell.key);
    const active = cell.key === focus.sourceKey || cell.key === focus.targetKey;
    const radius = active ? 14 : 11;
    graphCtx.fillStyle = _rgba(_cellColor(cell), active ? 0.95 : 0.78);
    graphCtx.strokeStyle = _rgba(_classificationColor(cell.classification), 0.95);
    graphCtx.lineWidth = active ? 2.2 : 1.3;
    graphCtx.beginPath();
    graphCtx.arc(pos.cx, pos.cy, radius, 0, 2 * Math.PI);
    graphCtx.fill();
    if (cell.ambiguous || cell.isDegenerate) graphCtx.setLineDash([3, 2]);
    graphCtx.stroke();
    graphCtx.setLineDash([]);
    graphCtx.fillStyle = '#1e1e1e';
    graphCtx.font = active ? '10px monospace' : '9.5px monospace';
    graphCtx.textAlign = 'center';
    graphCtx.textBaseline = 'middle';
    graphCtx.fillText(`${cell.goodVertexId + 1}|${cell.badVertexId + 1}`, pos.cx, pos.cy + 0.5);
    nodes.push({ cx: pos.cx, cy: pos.cy, r: radius + 3, cellKey: cell.key });
  }

  _lastInteractive.nodes = nodes;
  _lastInteractive.edges = edges;

  const panelCell = focus.sourceCell ?? focus.targetCell;
  if (panelCell) {
    const target = panelCell.targetPair
      ? `(${panelCell.targetPair.goodVertexId + 1},${panelCell.targetPair.badVertexId + 1})`
      : 'ambiguous';
    const lines = [
      `cell (${panelCell.goodVertexId + 1},${panelCell.badVertexId + 1})`,
      `class ${panelCell.classification}`,
      `T -> ${target}`,
    ];
    graphCtx.fillStyle = '#506070';
    graphCtx.font = '11px monospace';
    graphCtx.textAlign = 'left';
    lines.forEach((line, i) => graphCtx.fillText(line, rect.x + 16, rect.y + rect.h - 42 + i * 14));
  }
}

function _drawBinaryStatus(graphRect) {
  graphCtx.clearRect(0, 0, _graphLogical.w, _graphLogical.h);
  graphCtx.fillStyle = '#fff';
  graphCtx.fillRect(0, 0, _graphLogical.w, _graphLogical.h);
  if (state.rewardMode === 'binary' && _lastBinary?.enabled) return;
  const x = graphRect.x;
  const y = graphRect.y;
  graphCtx.fillStyle = 'rgba(255,255,255,0.92)';
  graphCtx.strokeStyle = '#ddd';
  graphCtx.lineWidth = 1;
  _roundRectOn(graphCtx, x, y, graphRect.w, 48, 10);
  graphCtx.fill();
  graphCtx.stroke();
  graphCtx.fillStyle = '#666';
  graphCtx.font = '11px Georgia,serif';
  graphCtx.textAlign = 'left';
  graphCtx.fillText(
    state.rewardMode === 'binary'
      ? (_lastBinary?.reason ?? 'Cell graph unavailable.')
      : 'Switch to binary rewards to view good/bad cells.',
    x + 12,
    y + 27
  );
}

function _graphRect() {
  const w = Math.max(240, _graphLogical.w - 18);
  const h = Math.max(260, _graphLogical.h - 24);
  return { x: 9, y: 12, w, h };
}

function _visibleCells(binary) {
  if (!binary?.enabled) return [];
  return binary.cells.filter(cell => {
    if (state.withSelfOnly && cell.classification !== 'trap') return false;
    if (!state.withAmbiguous && (cell.ambiguous || cell.isDegenerate || cell.classification === 'boundary')) return false;
    return true;
  });
}

function _resolveFocus(cellMap) {
  const focus = {
    sourceKey: state.hover?.type === 'cell' || state.hover?.type === 'node'
      ? state.hover.cellKey
      : state.hover?.type === 'edge'
        ? state.hover.sourceKey
        : state.selectedCellKey,
    targetKey: null,
    edgeSourceKey: state.hover?.type === 'edge' ? state.hover.sourceKey : null,
    sourceCell: null,
    targetCell: null,
  };
  focus.sourceCell = focus.sourceKey ? cellMap.get(focus.sourceKey) ?? null : null;
  if (state.hover?.type === 'edge' && state.hover.targetKey) focus.targetKey = state.hover.targetKey;
  else if (focus.sourceCell?.targetCellKey) focus.targetKey = focus.sourceCell.targetCellKey;
  focus.targetCell = focus.targetKey ? cellMap.get(focus.targetKey) ?? null : null;
  return focus;
}

function _getBinaryRefinement(X, r) {
  const key = _stateSignature(X, r);
  if (_binaryCache.key !== key) {
    _binaryCache = { key, value: computeBinaryRefinement(X, r) };
  }
  return _binaryCache.value;
}

function _getActionCones(X) {
  const key = _stateSignature(X);
  if (_actionConeCache.key !== key) {
    _actionConeCache = { key, value: X.map((_, i) => computeCone(i, X)) };
  }
  return _actionConeCache.value;
}

function _stateSignature(X, r = null) {
  return JSON.stringify({
    X: X.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]),
    r: r ? r.map(v => Number(v.toFixed(6))) : null,
  });
}

function _classificationColor(kind) {
  if (kind === 'trap') return '#1e8449';
  if (kind === 'exit') return '#d68910';
  return '#7f8c8d';
}

function _cellColor(cell) {
  const a = SET2[cell.goodVertexId % SET2.length];
  const b = SET2[cell.badVertexId % SET2.length];
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return `rgb(${Math.round((ra[0] * 0.56) + (rb[0] * 0.44))},${Math.round((ra[1] * 0.56) + (rb[1] * 0.44))},${Math.round((ra[2] * 0.56) + (rb[2] * 0.44))})`;
}

function _rgba(color, alpha) {
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  const rgb = /^#/.test(color) ? hexToRgb(color) : [80, 80, 80];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function _arcPath(ox, oy, innerR, outerR, start, end) {
  const outer = [];
  const inner = [];
  const steps = Math.max(12, Math.ceil((end - start) / (Math.PI / 48)));
  for (let i = 0; i <= steps; i++) {
    const a = start + (end - start) * i / steps;
    outer.push(w2c(outerR * Math.cos(a), outerR * Math.sin(a)));
    inner.push(w2c(innerR * Math.cos(a), innerR * Math.sin(a)));
  }
  ctx.moveTo(...outer[0]);
  outer.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  inner.reverse().forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
}

function _roundRect(x, y, w, h, r) {
  _roundRectOn(ctx, x, y, w, h, r);
}

function _roundRectOn(target, x, y, w, h, r) {
  target.beginPath();
  target.moveTo(x + r, y);
  target.lineTo(x + w - r, y);
  target.quadraticCurveTo(x + w, y, x + w, y + r);
  target.lineTo(x + w, y + h - r);
  target.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  target.lineTo(x + r, y + h);
  target.quadraticCurveTo(x, y + h, x, y + h - r);
  target.lineTo(x, y + r);
  target.quadraticCurveTo(x, y, x + r, y);
  target.closePath();
}

function _arrowOn(target, x1, y1, x2, y2, head = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const a = Math.atan2(dy, dx);
  target.beginPath();
  target.moveTo(x1, y1);
  target.lineTo(x2, y2);
  target.stroke();
  target.beginPath();
  target.moveTo(x2, y2);
  target.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
  target.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
  target.closePath();
  target.fill();
}

function _distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const _sub = n => String(n).split('').map(d => SUB_DIGITS[d]).join('');
const _fmt = v => v % 1 === 0 ? String(v) : v.toFixed(2);
