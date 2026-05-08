/**
 * ui.js — sidebar controls: sliders, toggles, action list, presets.
 *
 * Calls the provided callbacks to trigger recompute / re-render as needed.
 */
import { state, computed, PRESETS } from './state.js';
import { SET2 } from './colors.js';

/**
 * @param {object} hooks
 * @param {() => void} hooks.onRecompute   — full recompute needed (worker)
 * @param {() => void} hooks.onSyncField   — fast field-only sync
 * @param {() => void} hooks.onRender      — just re-render (no recompute)
 */
export function initUI({ onRecompute, onSyncField, onRender }) {

  // ── Toggles ────────────────────────────────────────────────────────────────
  const toggleMap = {
    'tog-cones': 'withCones',
    'tog-field': 'withField',
    'tog-sim':   'withSim',
    'tog-bary':  'withBary',
    'tog-hull':     'withHull',
    'tog-proj':     'withProjections',
    'tog-hull-sub': 'withHullSub',
    'tog-bary-sub': 'withBarySub',
  };
  for (const [id, key] of Object.entries(toggleMap)) {
    document.getElementById(id).addEventListener('change', e => {
      state[key] = e.target.checked;
      onRecompute();
    });
  }

  // ── Learning-rate slider (log₁₀ scale) ────────────────────────────────────
  const slLr  = document.getElementById('sl-lr');
  const valLr = document.getElementById('val-lr');
  slLr.value = '-2';  // log10(0.01) = -2
  valLr.textContent = '0.01';
  slLr.addEventListener('input', () => {
    const lr = Math.pow(10, parseFloat(slLr.value));
    state.lr = lr;
    valLr.textContent = lr >= 10 ? lr.toFixed(1)
                      : lr >= 1  ? lr.toFixed(2)
                      :            lr.toFixed(3);
    onRecompute();
  });

  // ── Steps slider ──────────────────────────────────────────────────────────
  const slSteps  = document.getElementById('sl-steps');
  const valSteps = document.getElementById('val-steps');
  slSteps.value = String(state.n_steps);
  valSteps.textContent = _stepsLabel(state.n_steps);
  slSteps.addEventListener('input', () => {
    state.n_steps = parseInt(slSteps.value);
    valSteps.textContent = _stepsLabel(state.n_steps);
    onRecompute();
  });

  // ── Add / remove actions ──────────────────────────────────────────────────
  document.getElementById('btn-add').addEventListener('click', () => {
    if (state.X.length >= 8) return;
    state.X.push([(Math.random()-0.5)*4, (Math.random()-0.5)*4]);
    state.r.push(0);
    buildActionList({ onRecompute, onSyncField });
    onRecompute();
  });
  document.getElementById('btn-remove').addEventListener('click', () => {
    if (state.X.length <= 2) return;
    state.X.pop(); state.r.pop();
    buildActionList({ onRecompute, onSyncField });
    onRecompute();
  });

  // ── Presets ───────────────────────────────────────────────────────────────
  const presetContainer = document.getElementById('preset-btns');
  for (const [key, p] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.className = 'preset';
    btn.textContent = key;
    btn.addEventListener('click', () => {
      state.X  = p.X.map(x => x.slice());
      state.r  = p.r.slice();
      state.w0 = p.w0.slice();
      buildActionList({ onRecompute, onSyncField });
      onRecompute();
    });
    presetContainer.appendChild(btn);
  }

  // Build initial list
  buildActionList({ onRecompute, onSyncField });
}

export function buildActionList({ onRecompute, onSyncField }) {
  const container = document.getElementById('action-list');
  container.innerHTML = '';
  state.X.forEach((x, k) => {
    const color = SET2[k % SET2.length];
    const row = document.createElement('div');
    row.className = 'action-row';
    row.innerHTML = `
      <span class="action-dot" style="background:${color}"></span>
      <span class="action-label">x<sub>${k+1}</sub></span>
      <span class="action-coord">
        [<input class="action-coord-input" type="number" step="0.01" id="coord-x-${k}" value="${x[0].toFixed(2)}">,
        <input class="action-coord-input" type="number" step="0.01" id="coord-y-${k}" value="${x[1].toFixed(2)}">]
      </span>
      <span class="action-r-wrap">
        r&nbsp;=&nbsp;<input class="action-r-input" type="checkbox" id="r-${k}"
          ${state.r[k] ? 'checked' : ''}>
      </span>
    `;
    container.appendChild(row);
    const onCoordChange = () => {
      const xInput = document.getElementById(`coord-x-${k}`);
      const yInput = document.getElementById(`coord-y-${k}`);
      if (!xInput || !yInput) return;
      const xVal = _clampCoord(_parseCoord(xInput.value, state.X[k][0]));
      const yVal = _clampCoord(_parseCoord(yInput.value, state.X[k][1]));
      state.X[k] = [xVal, yVal];
      xInput.value = xVal.toFixed(2);
      yInput.value = yVal.toFixed(2);
      onSyncField();
      onRecompute();
    };
    document.getElementById(`coord-x-${k}`).addEventListener('change', onCoordChange);
    document.getElementById(`coord-y-${k}`).addEventListener('change', onCoordChange);
    document.getElementById(`r-${k}`).addEventListener('change', e => {
      state.r[k] = e.target.checked ? 1 : 0;
      onSyncField();
      onRecompute();
    });
  });
}

export function updateCoordDisplay() {
  state.X.forEach((x, k) => {
    const xInput = document.getElementById(`coord-x-${k}`);
    const yInput = document.getElementById(`coord-y-${k}`);
    if (xInput) xInput.value = x[0].toFixed(2);
    if (yInput) yInput.value = x[1].toFixed(2);
  });
}

const _stepsLabel = n => n >= 1000 ? (n/1000).toFixed(0) + 'k' : String(n);
const _clampCoord = v => Math.max(-4, Math.min(4, v));
const _parseCoord = (raw, fallback) => {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};
