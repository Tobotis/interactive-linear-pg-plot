// Pure math — no DOM, no side effects.

export function softmax(z) {
  const mx = Math.max(...z);
  const ex = z.map(v => Math.exp(v - mx));
  const s  = ex.reduce((a, b) => a + b, 0);
  return ex.map(v => v / s);
}

export const dot    = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const vadd   = (a, b) => a.map((v, i) => v + b[i]);
export const vscale = (a, k) => a.map(v => v * k);
export const vnorm  = a      => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

export const GEOM_EPS = 1e-6;
export const ANGLE_EPS = 0.03;

/** Policy-gradient ∇_w V(w) = Xᵀ diag(π)(r − V(π)𝟏) */
export function pgGrad(X, r, w) {
  const pi  = softmax(X.map(x => dot(x, w)));
  const Vpi = pi.reduce((s, p, i) => s + p * r[i], 0);
  return [0, 1].map(d =>
    pi.reduce((s, p, i) => s + p * (r[i] - Vpi) * X[i][d], 0)
  );
}

/** Barycentric coord of marginal over optimal actions in feature space. */
export function barycentricOptimal(X, r, w) {
  const pi    = softmax(X.map(x => dot(x, w)));
  const maxR  = Math.max(...r);
  const piOpt = pi.map((p, i) => r[i] === maxR ? p : 0);
  const piSum = piOpt.reduce((a, b) => a + b, 0);
  if (piSum < 1e-30) return null;
  const lam = piOpt.map(p => p / piSum);
  return [0, 1].map(d => lam.reduce((s, l, i) => s + l * X[i][d], 0));
}

/** Barycentric coord of marginal over suboptimal actions in feature space. */
export function barycentricSuboptimal(X, r, w) {
  const pi    = softmax(X.map(x => dot(x, w)));
  const maxR  = Math.max(...r);
  const piSub = pi.map((p, i) => r[i] < maxR ? p : 0);
  const piSum = piSub.reduce((a, b) => a + b, 0);
  if (piSum < 1e-30) return null;
  const lam = piSub.map(p => p / piSum);
  return [0, 1].map(d => lam.reduce((s, l, i) => s + l * X[i][d], 0));
}

/** Cone for action a: { startAngle, endAngle, rays }.
 *  The set of w where action a is uniquely/jointly optimal. */
export function computeCone(a, X) {
  const normals = [];
  for (let b = 0; b < X.length; b++) {
    if (b === a) continue;
    const dx = X[a][0] - X[b][0], dy = X[a][1] - X[b][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;
    normals.push([dx / len, dy / len]);
  }
  if (!normals.length) return null;

  // Candidate boundary rays: perpendiculars to each face-normal that satisfy all constraints
  const candidates = [];
  for (const n of normals) {
    const p = [-n[1], n[0]];
    for (const d of [p, [-p[0], -p[1]]]) {
      if (normals.every(nc => nc[0] * d[0] + nc[1] * d[1] >= -1e-9))
        candidates.push(d);
    }
  }
  // Deduplicate
  const rays = [];
  for (const r of candidates)
    if (rays.every(u => r[0] * u[0] + r[1] * u[1] < 1 - 1e-6)) rays.push(r);

  if (rays.length < 2) return { rays };

  const [r1, r2] = rays;
  const a1   = Math.atan2(r1[1], r1[0]);
  const a2   = Math.atan2(r2[1], r2[0]);
  const span = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const mid  = [Math.cos(a1 + span / 2), Math.sin(a1 + span / 2)];
  const fwd  = normals.every(n => n[0] * mid[0] + n[1] * mid[1] >= -1e-9);

  return {
    startAngle: fwd ? a1       : a2,
    endAngle:   fwd ? a1 + span : a2 + (2 * Math.PI - span),
    rays,
  };
}

/** Gradient-field samples on an N×N grid over [−4,4]². */
export function computeField(X, r, N = 22) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const wx = -4 + 8 * i / (N - 1);
      const wy = -4 + 8 * j / (N - 1);
      const g   = pgGrad(X, r, [wx, wy]);
      const mag = vnorm(g);
      pts.push({ wx, wy, g, mag });
    }
  }
  const maxMag = Math.max(...pts.map(p => p.mag)) + 1e-12;
  return pts.map(p => ({ ...p, t: p.mag / maxMag }));
}

/** Run gradient ascent from w0 for n_steps, returning a sampled trajectory. */
export function runTrajectory(X, r, w0, lr, n_steps, maxPts = 2000) {
  const stride = Math.max(1, Math.floor(n_steps / maxPts));
  const traj = [w0.slice()];
  let w = w0.slice();
  for (let t = 0; t < n_steps; t++) {
    const g = pgGrad(X, r, w);
    if (vnorm(g) < 1e-7) break;   // converged — gradient has vanished
    w = vadd(w, vscale(g, lr));
    if (!isFinite(w[0]) || !isFinite(w[1]) || vnorm(w) > 1e6) break;
    if (t % stride === stride - 1) traj.push(w.slice());
  }
  traj.push(w.slice());
  return traj;
}

/** Andrew's monotone-chain convex hull. Returns vertices in CCW order. */
export function convexHull(pts) {
  if (pts.length <= 1) return pts.slice();
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (O, A, B) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const lower = [], upper = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

export function normalizeAngle(theta) {
  let a = theta % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

export function angleInInterval(theta, start, end, eps = ANGLE_EPS) {
  const a = normalizeAngle(theta);
  const s = normalizeAngle(start);
  const span = ((end - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (span >= 2 * Math.PI - eps) return true;
  const rel = ((a - s) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return rel > eps && rel < span - eps || Math.abs(rel) <= eps || Math.abs(rel - span) <= eps;
}

export function angleDistanceToBoundary(theta, start, end) {
  const span = ((end - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const rel = ((normalizeAngle(theta) - normalizeAngle(start)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (rel <= span) return Math.min(rel, span - rel);
  return Math.min(rel - span, 2 * Math.PI - rel);
}

function coneToInterval(cone) {
  if (!cone || cone.fullCircle) return { fullCircle: true, start: 0, end: 2 * Math.PI };
  if (cone.startAngle === undefined || cone.endAngle === undefined) return null;
  const start = normalizeAngle(cone.startAngle);
  const span = ((cone.endAngle - cone.startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (span >= 2 * Math.PI - GEOM_EPS) return { fullCircle: true, start: 0, end: 2 * Math.PI };
  return { fullCircle: false, start, end: start + span };
}

function intersectConeIntervals(a, b) {
  if (!a || !b) return null;
  if (a.fullCircle) return { start: b.start, end: b.end };
  if (b.fullCircle) return { start: a.start, end: a.end };
  for (const shift of [-2 * Math.PI, 0, 2 * Math.PI]) {
    const start = Math.max(a.start, b.start + shift);
    const end = Math.min(a.end, b.end + shift);
    if (end - start > GEOM_EPS) return { start, end };
  }
  return null;
}

function hullVerticesWithIds(X, ids) {
  const pts = ids.map(id => X[id]);
  if (pts.length <= 2) return ids.map(id => ({ id, point: X[id] }));
  const hull = convexHull(pts);
  return hull.map(point => ({ id: ids.find(id => X[id] === point), point }));
}


function makeConeForGroup(vertexId, groupIds, X) {
  if (groupIds.length <= 1) return { fullCircle: true, rays: [] };
  const groupPoints = groupIds.map(id => X[id]);
  const localIndex = groupIds.indexOf(vertexId);
  return computeCone(localIndex, groupPoints);
}

export function classifyRewardMode(r) {
  return r.every(v => Math.abs(v) <= GEOM_EPS || Math.abs(v - 1) <= GEOM_EPS)
    ? 'binary'
    : 'arbitrary';
}

export function computeBinaryRefinement(X, r) {
  const goodIds = [];
  const badIds = [];
  r.forEach((rv, i) => ((rv > 0.5) ? goodIds : badIds).push(i));
  const enabled = goodIds.length > 0 && badIds.length > 0;
  if (!enabled) {
    return {
      enabled: false,
      reason: 'Need at least one good and one bad action.',
      goodIds,
      badIds,
      goodVertices: [],
      badVertices: [],
      cells: [],
      transitions: [],
    };
  }

  const goodVertices = hullVerticesWithIds(X, goodIds).map(v => ({
    ...v,
    cone: makeConeForGroup(v.id, goodIds, X),
  }));
  const badVertices = hullVerticesWithIds(X, badIds).map(v => ({
    ...v,
    cone: makeConeForGroup(v.id, badIds, X),
  }));

  const cells = [];
  for (const gv of goodVertices) {
    const gInterval = coneToInterval(gv.cone);
    for (const bv of badVertices) {
      const bInterval = coneToInterval(bv.cone);
      const hit = intersectConeIntervals(gInterval, bInterval);
      if (!hit) continue;
      const driftVector = [X[gv.id][0] - X[bv.id][0], X[gv.id][1] - X[bv.id][1]];
      const driftNorm = vnorm(driftVector);
      const driftAngle = driftNorm < GEOM_EPS ? null : normalizeAngle(Math.atan2(driftVector[1], driftVector[0]));
      cells.push({
        key: `${gv.id}-${bv.id}`,
        goodVertexId: gv.id,
        badVertexId: bv.id,
        angleStart: hit.start,
        angleEnd: hit.end,
        angleMid: 0.5 * (hit.start + hit.end),
        angleSpan: hit.end - hit.start,
        isDegenerate: hit.end - hit.start < ANGLE_EPS,
        driftVector,
        driftNorm,
        driftAngle,
      });
    }
  }

  const byPair = new Map();
  for (const cell of cells) {
    const key = `${cell.goodVertexId}-${cell.badVertexId}`;
    const list = byPair.get(key) ?? [];
    list.push(cell);
    byPair.set(key, list);
  }

  // Sort cells by their starting angle to establish circular adjacency.
  // Cells are ordered counterclockwise; "right" = next in sorted order.
  const sortedByAngle = [...cells].sort(
    (a, b) => normalizeAngle(a.angleStart) - normalizeAngle(b.angleStart));
  const sortedIndex = new Map(sortedByAngle.map((c, i) => [c.key, i]));
  const N = sortedByAngle.length;

  const transitions = cells.map(cell => {
    const ambiguous = cell.driftNorm < GEOM_EPS || cell.driftAngle == null;
    let targetPair = null;
    let targetCellKey = null;
    let inside = false;

    if (!ambiguous) {
      inside = angleInInterval(cell.driftAngle, cell.angleStart, cell.angleEnd, ANGLE_EPS);
      if (inside) {
        // gamma ∈ (alpha, beta): stay in current cell
        targetCellKey = cell.key;
        targetPair = { goodVertexId: cell.goodVertexId, badVertexId: cell.badVertexId };
      } else {
        // Determine direction: compare gamma to [alpha, beta] on the circle.
        // rel measures how far gamma is from alpha, going counterclockwise.
        // span measures the cell's angular width.
        // The exterior arc midpoint is at rel = π + span/2;
        // rel ∈ (span, π+span/2) → gamma is past beta  → go right (next cell),
        // rel ∈ (π+span/2, 2π) → gamma is before alpha → go left (prev cell).
        const s    = normalizeAngle(cell.angleStart);
        const span = (normalizeAngle(cell.angleEnd) - s + 2 * Math.PI) % (2 * Math.PI);
        const rel  = (normalizeAngle(cell.driftAngle) - s + 2 * Math.PI) % (2 * Math.PI);
        const goRight = N > 1 && rel > span && rel < Math.PI + span / 2;
        const idx = sortedIndex.get(cell.key);
        const neighborIdx = goRight ? (idx + 1) % N : (idx - 1 + N) % N;
        const neighbor = sortedByAngle[neighborIdx];
        targetCellKey = neighbor.key;
        targetPair = { goodVertexId: neighbor.goodVertexId, badVertexId: neighbor.badVertexId };
      }
    }

    const boundaryLike = ambiguous || cell.driftAngle == null ||
      angleDistanceToBoundary(cell.driftAngle ?? cell.angleStart, cell.angleStart, cell.angleEnd) < ANGLE_EPS;
    return {
      ...cell,
      targetPair,
      targetCellKey,
      ambiguous,
      classification: boundaryLike ? 'boundary' : (inside ? 'trap' : 'exit'),
    };
  });

  return {
    enabled: true,
    goodIds,
    badIds,
    goodVertices,
    badVertices,
    cells: transitions,
    transitions,
  };
}
