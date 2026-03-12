/**
 * main.js — entry point.
 *
 * Wires together: canvas resize, drag interaction, UI controls, compute
 * pipeline, and the RAF render loop.
 *
 * Smoothness strategy:
 *   - Drag events → update state → scheduleRender() (immediate RAF frame)
 *   - Field is recomputed synchronously (~0.5 ms) on every drag event
 *   - Trajectory is computed in a Web Worker; stale result shown during drag
 *   - After dragging settles (80 ms debounce) a fresh worker request is sent
 */
import { state, computed } from './state.js';
import { canvas, resize, w2c, c2w, scheduleRender } from './render.js';
import { requestCompute, syncField, syncTrajectory } from './compute.js';
import { initUI, updateCoordDisplay } from './ui.js';

// ── KaTeX rendering ───────────────────────────────────────────────────────────
function renderKatex() {
  document.querySelectorAll('[data-latex]').forEach(el => {
    // eslint-disable-next-line no-undef
    katex.render(el.dataset.latex, el, { throwOnError: false, output: 'html' });
  });
}

// ── Compute pipeline ──────────────────────────────────────────────────────────
let _recomputeTimer = null;

function triggerRecompute(delay = 80) {
  clearTimeout(_recomputeTimer);
  _recomputeTimer = setTimeout(() => {
    requestCompute(result => {
      computed.field       = result.field       ?? computed.field;
      computed.traj        = result.traj;
      computed.baryTraj    = result.baryTraj    ?? null;
      computed.barySubTraj = result.barySubTraj ?? null;
      scheduleRender();
    });
  }, delay);
}

/** Full update: sync field + trajectory preview, render, then queue worker. */
function onRecompute() {
  syncField();
  syncTrajectory();
  scheduleRender();
  triggerRecompute();
}

/** During drag: sync field + fast trajectory preview immediately, full worker after settling. */
function onDragUpdate() {
  syncField();
  syncTrajectory();
  scheduleRender();
  triggerRecompute(120);  // slightly longer debounce while actively dragging
}

// ── Drag interaction ──────────────────────────────────────────────────────────
const HIT_R = 14;   // logical pixels
let dragging = null;  // { type: 'point'|'w0', index? }

function getXY(e) {
  // getBoundingClientRect() gives CSS pixels; canvas.style.width also CSS pixels.
  // Since ctx is scaled by DPR, our logical coordinate space == CSS pixel space.
  const rect = canvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  // Scale in case the canvas element is CSS-resized differently from its style size
  const sx   = parseFloat(canvas.style.width)  / rect.width;
  const sy   = parseFloat(canvas.style.height) / rect.height;
  return [(src.clientX - rect.left) * sx, (src.clientY - rect.top) * sy];
}

function hitTest(cx, cy) {
  // Feature points
  for (let k = 0; k < state.X.length; k++) {
    const [px, py] = w2c(state.X[k][0], state.X[k][1]);
    if ((px-cx)**2 + (py-cy)**2 < HIT_R**2) return { type:'point', index:k };
  }
  // w0
  if (state.withSim) {
    const [px, py] = w2c(state.w0[0], state.w0[1]);
    if ((px-cx)**2 + (py-cy)**2 < HIT_R**2) return { type:'w0' };
  }
  return null;
}

function onPointerDown(e) {
  const [cx, cy] = getXY(e);
  dragging = hitTest(cx, cy);
  if (dragging) canvas.classList.add('dragging');
}

function onPointerMove(e) {
  const [cx, cy] = getXY(e);
  if (dragging) {
    const [wx, wy] = c2w(cx, cy);
    const clamped  = [clamp(wx), clamp(wy)];
    if (dragging.type === 'point') {
      state.X[dragging.index] = clamped;
      updateCoordDisplay();
    } else {
      state.w0 = clamped;
    }
    onDragUpdate();
  } else {
    canvas.style.cursor = hitTest(cx, cy) ? 'grab' : 'crosshair';
  }
}

function onPointerUp() {
  if (dragging) {
    dragging = null;
    canvas.classList.remove('dragging');
    // Do an immediate recompute now that drag has settled
    triggerRecompute(0);
  }
}

const clamp = v => Math.max(-4, Math.min(4, v));

// Mouse
canvas.addEventListener('mousedown',  onPointerDown);
window.addEventListener('mousemove',  onPointerMove);
window.addEventListener('mouseup',    onPointerUp);

// Touch
canvas.addEventListener('touchstart', e => { e.preventDefault(); onPointerDown(e); }, { passive:false });
canvas.addEventListener('touchmove',  e => { e.preventDefault(); onPointerMove(e); }, { passive:false });
canvas.addEventListener('touchend',   e => { e.preventDefault(); onPointerUp();    }, { passive:false });

// ── Resize handling ───────────────────────────────────────────────────────────
const ro = new ResizeObserver(() => { resize(); scheduleRender(); });
ro.observe(canvas.parentElement);

// ── UI controls ───────────────────────────────────────────────────────────────
initUI({
  onRecompute,
  onSyncField: () => { syncField(); scheduleRender(); },
  onRender:    scheduleRender,
});

// ── Boot ──────────────────────────────────────────────────────────────────────
renderKatex();
resize();
onRecompute();
