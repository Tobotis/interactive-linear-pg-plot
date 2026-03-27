export const PRESETS = {
  // ── Binary reward presets ──────────────────────────────────────────────
  "2-good 1-bad":          { X: [[0,1],[-1,-1],[2.5,-0.5]],                       r: [1,1,0],       w0: [3,-2]  },
  "1-good 2-bad":          { X: [[2,0],[-1,1.7],[-1,-1.7]],                       r: [1,0,0],       w0: [-3,0]  },
  "3-good 1-bad":          { X: [[0,1],[-1,-1],[2,0],[2.5,-0.5]],                 r: [1,1,1,0],     w0: [3,2]   },
  "2-good 2-bad":          { X: [[1,1],[-1,1],[-1,-1],[1,-1]],                    r: [1,1,0,0],     w0: [3,0]   },
  "1-good 3-bad":          { X: [[2,0],[0,2],[-2,0],[0,-2]],                      r: [1,0,0,0],     w0: [-3,-3] },
  "split good hull":       { X: [[2,1],[2,-1],[-2,0],[0,2]],                      r: [1,1,0,0],     w0: [-3,0]  },
  "collinear 2-good":      { X: [[-2,0],[0,0],[2,0]],                              r: [1,1,0],       w0: [0,3]   },
  "degenerate":            { X: [[1,1],[-1,1],[-2,-2],[2,-2]],                    r: [1,1,0,0],     w0: [0,0]   },
  // ── Arbitrary reward presets ───────────────────────────────────────────
  "graded triangle":       { X: [[2,0],[0,2],[-2,-1]],                            r: [1,0.6,0.2],   w0: [-2,2]  },
  "4-level rewards":       { X: [[1.5,1.5],[-1.5,1.5],[-1.5,-1.5],[1.5,-1.5]],    r: [1,0.7,0.3,0], w0: [0,0]   },
  "close rewards":         { X: [[2,0],[-1,1.7],[-1,-1.7]],                       r: [1,0.9,0.8],   w0: [0,3]   },
};

export const state = {
          X: [[0,1],[-1,-1],[2.5,-0.5]],   // X7 default
 r: [1,1,0], w0: [3,-2],
  rewardMode: 'binary',
  lr:       0.01,
  n_steps:  50000,
  withConeBackground: true,
  withGoodCones:   false,
  withBadCones:    false,
  withField:       false,
  withSim:         false,
  withBary:        false,
  withHull:        false,
  withProjections: false,
  withHullSub:     false,
  withBarySub:     false,
  withDiffCone:    false,
  withCells:       true,
  driftMode:       'selected',
  withGraph:       false,
  withSelfOnly:    false,
  withSelectedEdgeOnly: false,
  withAmbiguous:   true,
  hover:           null,
  selectedCellKey: null,
};

/** Shared cache of heavy computation results (filled by the worker). */
export const computed = {
  field:    null,   // { wx, wy, g, mag, t }[]
  traj:     null,   // [w][] sampled trajectory
  baryTraj:    null,   // ([x,y] | null)[]
  barySubTraj: null,   // ([x,y] | null)[]
  dirty:    true,   // true when recompute needed
};
