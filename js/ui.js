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
    'tog-hull':  'withHull',
    'tog-proj':   'withProjections',
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
  slLr.value = '1';  // log10(10) = 1
  valLr.textContent = '10.0';
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
  document.querySelectorAll('button.preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = PRESETS[btn.dataset.preset];
      if (!p) return;
      state.X  = p.X.map(x => x.slice());
      state.r  = p.r.slice();
      state.w0 = p.w0.slice();
      buildActionList({ onRecompute, onSyncField });
      onRecompute();
    });
  });

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
      <span class="action-coord" id="coord-${k}">[${x[0].toFixed(2)}, ${x[1].toFixed(2)}]</span>
      <span class="action-r-wrap">
        r&nbsp;=&nbsp;<input class="action-r-input" type="number" id="r-${k}"
          value="${state.r[k]}" step="0.5">
      </span>
    `;
    container.appendChild(row);
    document.getElementById(`r-${k}`).addEventListener('input', e => {
      state.r[k] = parseFloat(e.target.value) || 0;
      onSyncField();
      onRecompute();
    });
  });
}

export function updateCoordDisplay() {
  state.X.forEach((x, k) => {
    const el = document.getElementById(`coord-${k}`);
    if (el) el.textContent = `[${x[0].toFixed(2)}, ${x[1].toFixed(2)}]`;
  });
}

const _stepsLabel = n => n >= 1000 ? (n/1000).toFixed(0) + 'k' : String(n);
