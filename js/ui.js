/**
 * ui.js — sidebar controls: sliders, toggles, action list, presets.
 *
 * Calls the provided callbacks to trigger recompute / re-render as needed.
 */
import { state, PRESETS } from './state.js';
import { SET2 } from './colors.js';
import { classifyRewardMode } from './math.js';

/**
 * @param {object} hooks
 * @param {() => void} hooks.onRecompute   — full recompute needed (worker)
 * @param {() => void} hooks.onSyncField   — fast field-only sync
 * @param {() => void} hooks.onRender      — just re-render (no recompute)
 */
export function initUI({ onRecompute, onSyncField, onRender }) {
  document.querySelectorAll('.mode-option').forEach(btn => {
    btn.addEventListener('click', () => {
      setRewardMode(btn.dataset.mode, { onRecompute, onSyncField });
    });
  });

  // ── Toggles ────────────────────────────────────────────────────────────────
  const toggleMap = {
    'tog-cone-bg': 'withConeBackground',
    'tog-good-cones': 'withGoodCones',
    'tog-bad-cones': 'withBadCones',
    'tog-field': 'withField',
    'tog-sim':   'withSim',
    'tog-bary':  'withBary',
    'tog-hull':     'withHull',
    'tog-proj':     'withProjections',
    'tog-hull-sub':  'withHullSub',
    'tog-bary-sub':  'withBarySub',
    'tog-diff-cone': 'withDiffCone',
    'tog-cells': 'withCells',
    'tog-graph': 'withGraph',
    'tog-self-only': 'withSelfOnly',
    'tog-selected-edge': 'withSelectedEdgeOnly',
    'tog-ambiguous': 'withAmbiguous',
  };
  for (const [id, key] of Object.entries(toggleMap)) {
    document.getElementById(id).checked = Boolean(state[key]);
    document.getElementById(id).addEventListener('change', e => {
      state[key] = e.target.checked;
      if (id === 'tog-good-cones' && e.target.checked) {
        state.withBadCones = false;
        state.withCells = false;
      }
      if (id === 'tog-bad-cones' && e.target.checked) {
        state.withGoodCones = false;
        state.withCells = false;
      }
      if (id === 'tog-cells' && e.target.checked) {
        state.withGoodCones = false;
        state.withBadCones = false;
      }
      if (key === 'withConeBackground' || key === 'withGoodCones' || key === 'withBadCones' || key === 'withCells') {
        syncBinaryUiState();
        onRender();
      } else {
        onRecompute();
      }
    });
  }

  const driftMode = document.getElementById('sel-drift-mode');
  driftMode.value = state.driftMode;
  driftMode.addEventListener('change', e => {
    state.driftMode = e.target.value;
    onRender();
  });

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

  // ── Copy actions ──────────────────────────────────────────────────────────
  document.getElementById('btn-copy-actions').addEventListener('click', () => {
    const rows = state.X.map((x, k) => {
      const label = `# x${k+1}  ${state.rewardMode === 'binary' ? (state.r[k] > 0.5 ? 'good' : 'bad') : `r = ${state.r[k]}`}`;
      return `    [${x[0].toFixed(2).padStart(6)}, ${x[1].toFixed(2).padStart(6)}],   ${label}`;
    });
    const rVals = state.r.map(v => Number.isInteger(v) ? `${v}.` : v.toFixed(2)).join(', ');
    const text = `X = np.array([\n${rows.join('\n')}\n], dtype=float)\n\nr = np.array([${rVals}])`;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-actions');
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    });
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
      state.rewardMode = classifyRewardMode(state.r);
      buildActionList({ onRecompute, onSyncField });
      syncBinaryUiState();
      onRecompute();
    });
    presetContainer.appendChild(btn);
  }

  // Build initial list
  buildActionList({ onRecompute, onSyncField });
  syncBinaryUiState();
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
        <input class="coord-input" type="number" id="coord-x-${k}" value="${x[0].toFixed(3)}" step="0.1">
        <input class="coord-input" type="number" id="coord-y-${k}" value="${x[1].toFixed(3)}" step="0.1">
      </span>
      ${state.rewardMode === 'binary'
        ? `<label class="action-binary-wrap">
            <input type="checkbox" id="r-${k}" ${state.r[k] > 0.5 ? 'checked' : ''}>
            <span>good</span>
          </label>`
        : `<span class="action-r-wrap">
            r&nbsp;=&nbsp;<input class="action-r-input" type="number" id="r-${k}"
              value="${state.r[k]}" step="0.5">
          </span>`
      }
    `;
    container.appendChild(row);
    document.getElementById(`r-${k}`).addEventListener(state.rewardMode === 'binary' ? 'change' : 'input', e => {
      state.r[k] = state.rewardMode === 'binary'
        ? (e.target.checked ? 1 : 0)
        : (parseFloat(e.target.value) || 0);
      onSyncField();
      onRecompute();
    });
    const xInput = document.getElementById(`coord-x-${k}`);
    const yInput = document.getElementById(`coord-y-${k}`);
    const onCoordInput = () => {
      const xv = parseFloat(xInput.value);
      const yv = parseFloat(yInput.value);
      if (isNaN(xv) || isNaN(yv)) return;
      state.X[k] = [xv, yv];
      onRecompute();
    };
    xInput.addEventListener('input', onCoordInput);
    yInput.addEventListener('input', onCoordInput);
  });
}

export function updateCoordDisplay() {
  state.X.forEach((x, k) => {
    const xEl = document.getElementById(`coord-x-${k}`);
    const yEl = document.getElementById(`coord-y-${k}`);
    if (xEl && document.activeElement !== xEl) xEl.value = x[0].toFixed(3);
    if (yEl && document.activeElement !== yEl) yEl.value = x[1].toFixed(3);
  });
}

const _stepsLabel = n => n >= 1000 ? (n/1000).toFixed(0) + 'k' : String(n);

function syncBinaryUiState() {
  const binaryOnly = ['tog-good-cones', 'tog-bad-cones', 'tog-cells', 'tog-graph', 'tog-self-only', 'tog-selected-edge', 'tog-ambiguous', 'sel-drift-mode'];
  const disabled = state.rewardMode !== 'binary';
  binaryOnly.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });

  // Handle the sub-toggle block for cone options
  const coneBlock = document.getElementById('binary-cone-block');
  if (coneBlock) coneBlock.classList.toggle('is-disabled', !state.withConeBackground || disabled);
  ['tog-good-cones', 'tog-bad-cones', 'tog-cells'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled || !state.withConeBackground;
  });

  // Handle the graph group
  const graphGroup = document.getElementById('binary-graph-group');
  if (graphGroup) graphGroup.classList.toggle('is-disabled', disabled);

  const checkedMap = {
    'tog-good-cones': state.withGoodCones,
    'tog-bad-cones': state.withBadCones,
    'tog-cells': state.withCells,
  };
  Object.entries(checkedMap).forEach(([id, checked]) => {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  });
  const coneBg = document.getElementById('tog-cone-bg');
  if (coneBg) coneBg.checked = state.withConeBackground;
  const note = document.getElementById('binary-tools-note');
  if (note) note.style.display = disabled ? 'block' : 'none';

  document.body.dataset.rewardMode = state.rewardMode;
  document.querySelectorAll('.mode-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.rewardMode);
  });
  const copy = document.getElementById('reward-mode-copy');
  if (copy) {
    copy.textContent = state.rewardMode === 'binary'
      ? 'Binary mode exposes the good/bad split, lets you layer good and bad cone fans, and shows the common-refinement switching graph.'
      : 'Arbitrary mode keeps the full reward values and falls back to the generic action-cone view instead of a good/bad partition.';
  }
}

function setRewardMode(mode, { onRecompute, onSyncField }) {
  if (state.rewardMode === mode) return;
  state.rewardMode = mode;
  if (state.rewardMode === 'binary') {
    const maxR = Math.max(...state.r);
    state.r = state.r.map(rv => Math.abs(rv - maxR) < 1e-9 ? 1 : 0);
  }
  buildActionList({ onRecompute, onSyncField });
  syncBinaryUiState();
  onRecompute();
}
