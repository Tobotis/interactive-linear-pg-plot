/**
 * render.js — canvas setup and all drawing routines.
 *
 * Coordinate system: world space is [−4,4]×[−4,4].
 * After ctx.scale(dpr,dpr) all draw calls use CSS/logical pixels.
 */
import { state, computed } from './state.js';
import { SET2, hexToRgb, blueColor } from './colors.js';
import { computeCone, convexHull, dot, barycentricOptimal, barycentricSuboptimal } from './math.js';


/** Return the current barycentric start point in world coords, or null. */
export function getBaryStart() {
  const { X, r, w0, withSim, withBary } = state;
  if (!withSim || !withBary) return null;
  return barycentricOptimal(X, r, w0);
}

// ── Canvas globals ────────────────────────────────────────────────────────────
export const canvas = document.getElementById('canvas');
export const ctx    = canvas.getContext('2d');

const WORLD = { min: -4, max: 4, span: 8 };
const PAD   = 50;   // logical-pixel padding inside the canvas

let _logicalSize = 600;   // updated by resize()

export function getLogicalSize() { return _logicalSize; }

// ── Coordinate transforms ─────────────────────────────────────────────────────
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

/** Resize canvas to fill the available area (square, HiDPI-aware). */
export function resize() {
  const wrap = canvas.parentElement.getBoundingClientRect();
  const size = Math.floor(Math.min(wrap.width, wrap.height) * 0.97);
  _logicalSize = size;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // logical-pixel mode
}

// ── RAF render loop ───────────────────────────────────────────────────────────
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

// ── Drawing helpers ───────────────────────────────────────────────────────────
function arrow(x1, y1, x2, y2, head = 6) {
  const dx = x2-x1, dy = y2-y1, a = Math.atan2(dy, dx);
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head*Math.cos(a-0.4), y2 - head*Math.sin(a-0.4));
  ctx.lineTo(x2 - head*Math.cos(a+0.4), y2 - head*Math.sin(a+0.4));
  ctx.closePath(); ctx.fill();
}

function star(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = -Math.PI/2 + i*2*Math.PI/5, a2 = a1 + Math.PI/5;
    i === 0
      ? ctx.moveTo(cx + r*Math.cos(a1), cy + r*Math.sin(a1))
      : ctx.lineTo(cx + r*Math.cos(a1), cy + r*Math.sin(a1));
    ctx.lineTo(cx + r/2.3*Math.cos(a2), cy + r/2.3*Math.sin(a2));
  }
  ctx.closePath();
}

// ── Main draw ─────────────────────────────────────────────────────────────────
export function draw() {
  const { X, r, w0, withCones, withField, withSim, withBary, withHull, withHullSub, withBarySub } = state;
  const n  = X.length;
  const sz = _logicalSize;

  ctx.clearRect(0, 0, sz, sz);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sz, sz);

  // ── Precompute convex hulls ───────────────────────────────────────────────
  const maxR    = Math.max(...r);
  const optPts  = X.filter((_, i) => r[i] === maxR);
  const subIdxs = X.reduce((a, _, i) => r[i] !== maxR ? [...a,i] : a, []);
  const subPts  = X.filter((_, i) => r[i] < maxR);
  let hullVerts = [], hullEdges = [];
  if (optPts.length >= 3) {
    hullVerts = convexHull(optPts);
    hullEdges = hullVerts.map((v, i) => [v, hullVerts[(i+1) % hullVerts.length]]);
  } else if (optPts.length === 2) {
    hullVerts = optPts;
    hullEdges = [[optPts[0], optPts[1]]];
  } else if (optPts.length === 1) {
    hullVerts = optPts;
  }
  let hullSubVerts = [];
  if (subPts.length >= 3)      hullSubVerts = convexHull(subPts);
  else if (subPts.length >= 1) hullSubVerts = subPts.slice();

  // Clip to plot area
  ctx.save();
  ctx.beginPath(); ctx.rect(PAD, PAD, sz-2*PAD, sz-2*PAD); ctx.clip();

  // ── Action cones ──────────────────────────────────────────────────────────
  if (withCones) {
    const R = 4000;
    for (let a = 0; a < n; a++) {
      const cone = computeCone(a, X);
      if (!cone || cone.startAngle === undefined) continue;
      const { startAngle, endAngle, rays } = cone;
      const [ox, oy] = w2c(0, 0);
      const rgb = hexToRgb(SET2[a % SET2.length]);

      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.17)`;
      ctx.beginPath(); ctx.moveTo(ox, oy);
      for (let s = 0; s <= 360; s++) {
        const ang = startAngle + (endAngle - startAngle) * s / 360;
        const [px, py] = w2c(R*Math.cos(ang), R*Math.sin(ang));
        ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();

      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`;
      ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      for (const ray of rays) {
        const [px, py] = w2c(R*ray[0], R*ray[1]);
        ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(px,py); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // ── Gradient field ────────────────────────────────────────────────────────
  if (withField && computed.field) {
    const sc = (sz - 2*PAD) / WORLD.span * 0.17;   // arrow length as fraction of cell
    for (const pt of computed.field) {
      if (pt.mag < 1e-12) continue;
      const un  = [pt.g[0]/pt.mag, pt.g[1]/pt.mag];
      const [cx, cy] = w2c(pt.wx, pt.wy);
      const color = blueColor(pt.t);
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = 1.1; ctx.globalAlpha = 0.85;
      arrow(cx, cy, cx + un[0]*sc, cy - un[1]*sc, 5);
      ctx.globalAlpha = 1;
    }
  }

  // ── Barycentric trajectory ────────────────────────────────────────────────
  if (withBary && computed.baryTraj?.length > 1) {
    const bt = computed.baryTraj.filter(Boolean);
    if (bt.length > 1) {
      ctx.strokeStyle = '#2980b9'; ctx.lineWidth = 1.7;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const [bx0,by0] = w2c(...bt[0]); ctx.moveTo(bx0,by0);
      for (let i=1;i<bt.length;i++) { const [bx,by]=w2c(...bt[i]); ctx.lineTo(bx,by); }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Start point — open circle
      const [bx0c,by0c] = w2c(...bt[0]);
      ctx.fillStyle='#fff'; ctx.strokeStyle='#2980b9'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(bx0c,by0c,4.5,0,2*Math.PI); ctx.fill(); ctx.stroke();

      // End point — filled circle
      const last = bt[bt.length-1];
      const [bxf,byf] = w2c(...last);
      ctx.fillStyle='#2980b9'; ctx.strokeStyle='#222'; ctx.lineWidth=0.8;
      ctx.beginPath(); ctx.arc(bxf,byf,5.5,0,2*Math.PI); ctx.fill(); ctx.stroke();
    }
  }

  // ── Suboptimal barycentric trajectory x̄_t^- ──────────────────────────────
  if (withBarySub && computed.barySubTraj?.length > 1) {
    const bt = computed.barySubTraj.filter(Boolean);
    if (bt.length > 1) {
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.7;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const [bx0,by0] = w2c(...bt[0]); ctx.moveTo(bx0,by0);
      for (let i=1;i<bt.length;i++) { const [bx,by]=w2c(...bt[i]); ctx.lineTo(bx,by); }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const [bx0c,by0c] = w2c(...bt[0]);
      ctx.fillStyle='#fff'; ctx.strokeStyle='#c0392b'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(bx0c,by0c,4.5,0,2*Math.PI); ctx.fill(); ctx.stroke();
      const last = bt[bt.length-1];
      const [bxf,byf] = w2c(...last);
      ctx.fillStyle='#c0392b'; ctx.strokeStyle='#222'; ctx.lineWidth=0.8;
      ctx.beginPath(); ctx.arc(bxf,byf,5.5,0,2*Math.PI); ctx.fill(); ctx.stroke();
    }
  }

  // ── Barycentric start marker — open diamond, coupled to w0, draggable ────
  if (withBary && withSim) {
    const bs = barycentricOptimal(X, r, w0);
    if (bs) {
      const [bx, by] = w2c(...bs);
      const d = 7;
      ctx.fillStyle='white'; ctx.strokeStyle='#2980b9'; ctx.lineWidth=1.8;
      ctx.beginPath();
      ctx.moveTo(bx, by-d); ctx.lineTo(bx+d, by);
      ctx.lineTo(bx, by+d); ctx.lineTo(bx-d, by);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  // ── Convex hull of optimal actions + orthogonal projections ──────────────
  {
    // (hullVerts, hullEdges, subIdxs already computed above)

    // Draw hull
    if (withHull && hullVerts.length >= 2) {
      ctx.strokeStyle='rgba(41,128,185,0.65)'; ctx.lineWidth=1.6; ctx.setLineDash([4,3]);
      ctx.beginPath();
      const [hx0,hy0]=w2c(...hullVerts[0]); ctx.moveTo(hx0,hy0);
      for (let i=1;i<hullVerts.length;i++){ const [hx,hy]=w2c(...hullVerts[i]); ctx.lineTo(hx,hy); }
      if (hullVerts.length >= 3) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw projections of suboptimal actions onto each hull edge/line
    if (state.withProjections && hullEdges.length > 0 && subIdxs.length > 0) {
      for (const si of subIdxs) {
        const P      = X[si];
        const color  = SET2[si % SET2.length];
        const rgb    = hexToRgb(color);
        const [px,py] = w2c(...P);

        for (const [A, B] of hullEdges) {
          const dw   = [B[0]-A[0], B[1]-A[1]];   // edge direction (world)
          const len2 = dw[0]*dw[0] + dw[1]*dw[1];
          if (len2 < 1e-20) continue;

          // t ∈ [0,1] means projection lies on the segment
          const t    = ((P[0]-A[0])*dw[0] + (P[1]-A[1])*dw[1]) / len2;
          const proj = [A[0]+t*dw[0], A[1]+t*dw[1]];
          const [qx,qy] = w2c(...proj);

          const cpLen = Math.hypot(px-qx, py-qy);
          if (cpLen < 0.5) continue;   // P lies on the line — nothing to draw

          // 1. Extension of the edge to reach the projection (if outside segment)
          if ((t < 0 || t > 1)) {
            const [nx,ny] = w2c(...(t < 0 ? A : B));   // nearest hull vertex
            ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.30)`;
            ctx.lineWidth = 1; ctx.setLineDash([3,5]);
            ctx.beginPath(); ctx.moveTo(nx,ny); ctx.lineTo(qx,qy); ctx.stroke();
            ctx.setLineDash([]);
          }

          // 2. Perpendicular from P to proj
          ctx.strokeStyle = color; ctx.lineWidth = 1.3;
          ctx.setLineDash([3,3]);
          ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(qx,qy); ctx.stroke();
          ctx.setLineDash([]);

          // 3. Right-angle marker at proj
          //    ce = unit vector along edge in canvas space (A→B direction)
          //    cp = unit vector from proj toward P in canvas space
          const [ax,ay] = w2c(...A), [bx,by] = w2c(...B);
          const ceLen = Math.hypot(bx-ax, by-ay);
          if (ceLen < 0.5) continue;
          const ce = [(bx-ax)/ceLen, (by-ay)/ceLen];
          const cp = [(px-qx)/cpLen, (py-qy)/cpLen];
          const m  = 6;   // marker arm length, canvas px
          ctx.strokeStyle = color; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(qx + ce[0]*m,          qy + ce[1]*m);
          ctx.lineTo(qx + ce[0]*m + cp[0]*m, qy + ce[1]*m + cp[1]*m);
          ctx.lineTo(qx            + cp[0]*m, qy            + cp[1]*m);
          ctx.stroke();

          // 4. Filled dot at projection point
          ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(qx,qy,3.5,0,2*Math.PI); ctx.fill(); ctx.stroke();
        }
      }
    }
  }

  // ── Convex hull of suboptimal actions conv(A\A*) ─────────────────────────
  if (withHullSub && hullSubVerts.length >= 2) {
    ctx.strokeStyle='rgba(192,57,43,0.65)'; ctx.lineWidth=1.6; ctx.setLineDash([4,3]);
    ctx.beginPath();
    const [hx0,hy0]=w2c(...hullSubVerts[0]); ctx.moveTo(hx0,hy0);
    for (let i=1;i<hullSubVerts.length;i++){ const [hx,hy]=w2c(...hullSubVerts[i]); ctx.lineTo(hx,hy); }
    if (hullSubVerts.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── PG trajectory ─────────────────────────────────────────────────────────
  if (withSim && computed.traj?.length > 1) {
    const traj = computed.traj;
    ctx.strokeStyle='#2c2c2c'; ctx.lineWidth=1.8;
    ctx.beginPath();
    const [x0,y0]=w2c(...traj[0]); ctx.moveTo(x0,y0);
    for (let i=1;i<traj.length;i++){ const [xi,yi]=w2c(...traj[i]); ctx.lineTo(xi,yi); }
    ctx.stroke();

    // w_T star marker
    const wT = traj[traj.length-1];
    if (isFinite(wT[0])) {
      const [ex,ey]=w2c(...wT);
      ctx.fillStyle='#2c2c2c'; star(ex,ey,8); ctx.fill();
    }
  }

  // ── w0 marker (always visible when sim active) ────────────────────────────
  if (withSim) {
    const [sx,sy] = w2c(w0[0], w0[1]);
    ctx.fillStyle='#fff'; ctx.strokeStyle='#333'; ctx.lineWidth=1.8;
    ctx.beginPath(); ctx.arc(sx,sy,6.5,0,2*Math.PI); ctx.fill(); ctx.stroke();
  }

  // ── Feature points ────────────────────────────────────────────────────────
  for (let k=0;k<n;k++) {
    const [px,py] = w2c(X[k][0], X[k][1]);
    ctx.fillStyle   = SET2[k % SET2.length];
    ctx.strokeStyle = '#444'; ctx.lineWidth=0.9;
    ctx.beginPath(); ctx.arc(px,py,7.5,0,2*Math.PI); ctx.fill(); ctx.stroke();

    ctx.fillStyle='#1a1a1a'; ctx.font='italic 13px Georgia,serif'; ctx.textAlign='left';
    ctx.fillText(`x\u2080`.replace('\u2080', _sub(k+1)), px+11, py-3);
    ctx.fillStyle='#777'; ctx.font='10.5px monospace';
    ctx.fillText(`r=${_fmt(r[k])}`, px+11, py+10);
  }

  ctx.restore();  // remove clip

  // ── Axes ──────────────────────────────────────────────────────────────────
  const [ax0,ay0]=w2c(0,WORLD.min), [ax1,ay1]=w2c(0,WORLD.max);
  const [bx0,by0]=w2c(WORLD.min,0), [bx1,by1]=w2c(WORLD.max,0);
  ctx.strokeStyle='#b8b8b8'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(ax0,ay0); ctx.lineTo(ax1,ay1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx0,by0); ctx.lineTo(bx1,by1); ctx.stroke();

  // Ticks
  ctx.fillStyle='#999'; ctx.font='10px sans-serif';
  for (let v=-4;v<=4;v+=2) {
    if (!v) continue;
    const [tx,ty]=w2c(v,0);
    ctx.textAlign='center'; ctx.fillText(v,tx,ty+15);
    const [tx2,ty2]=w2c(0,v);
    ctx.textAlign='right'; ctx.fillText(v,tx2-5,ty2+4);
  }

  // Axis labels — use nice Unicode
  ctx.fillStyle='#555'; ctx.font='italic 13px Georgia,serif';
  ctx.textAlign='center'; ctx.fillText('w\u2081', sz/2, sz-9);
  ctx.save();
  ctx.translate(15, sz/2); ctx.rotate(-Math.PI/2);
  ctx.fillText('w\u2082', 0, 0); ctx.restore();

  // Frame
  ctx.strokeStyle='#d0d0d0'; ctx.lineWidth=1;
  ctx.strokeRect(PAD, PAD, sz-2*PAD, sz-2*PAD);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const _sub  = n => String(n).split('').map(d=>SUB_DIGITS[d]).join('');
const _fmt  = v => v % 1 === 0 ? String(v) : v.toFixed(2);
