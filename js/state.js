export const PRESETS = {
  intro:     { X: [[3,3],[-1,1],[-2,-3]],                             r: [3,2,1],   w0: [3,2]  },
  'viol-a2': { X: [[2,2],[1,1],[3,3]],                                r: [3,2,1],   w0: [0,0]  },
  equil:     { X: [[-2,-2],[0,-2],[-1, Math.sqrt(3)-2],[1,1]],        r: [1,1,1,0], w0: [2,2]  },
  x7:        { X: [[0,1],[-1,-1],[2,0],[2.5,-0.5]],                   r: [1,1,1,0], w0: [3,2]  },
  sep:       { X: [[0.5,0.5],[2,1],[3,2],[-1,-0.5],[-3,-0.4],[-2,-3]], r: [1,1,1,0,0,0], w0: [0,0] },
};

export const state = {
  X:        [[0,1],[-1,-1],[2,0],[2.5,-0.5]],   // X7 default
  r:        [1,1,1,0],
  w0:       [3,2],
  lr:       10,
  n_steps:  50000,
  withCones:       true,
  withField:       true,
  withSim:         true,
  withBary:        true,
  withHull:        true,
  withProjections: true,
};

/** Shared cache of heavy computation results (filled by the worker). */
export const computed = {
  field:    null,   // { wx, wy, g, mag, t }[]
  traj:     null,   // [w][] sampled trajectory
  baryTraj: null,   // ([x,y] | null)[]
  dirty:    true,   // true when recompute needed
};
