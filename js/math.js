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
