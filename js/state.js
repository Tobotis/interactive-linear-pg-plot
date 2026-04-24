export const PRESETS = {
  "2-good 1-bad":        { X: [[0,1],[-1,-1],[2.5,-0.5]],                   r: [1,1,0], w0: [3,-2]  },
  "3-good 1-bad":        { X: [[0,1],[-1,-1],[2,0],[2.5,-0.5]],                   r: [1,1,1,0], w0: [3,2]  },
};

export const state = {
          X: [[0,1],[-1,-1],[2.5,-0.5]],   // X7 default
 r: [1,1,0], w0: [3,-2],
  lr:       0.01,
  n_steps:  50000,
  withCones:       true,
  withField:       true,
  withSim:         true,
  withBary:        true,
  withHull:        true,
  withProjections: true,
  withHullSub:     false,
  withBarySub:     false,
};

/** Shared cache of heavy computation results (filled by the worker). */
export const computed = {
  field:    null,   // { wx, wy, g, mag, t }[]
  traj:     null,   // [w][] sampled trajectory
  baryTraj:    null,   // ([x,y] | null)[]
  barySubTraj: null,   // ([x,y] | null)[]
  dirty:    true,   // true when recompute needed
};
