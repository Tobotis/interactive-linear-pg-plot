/**
 * compute.js — manages a Web Worker for expensive trajectory computation.
 *
 * The worker is created from a Blob URL so no separate file / server is needed.
 * Field and cone data are computed synchronously (they're cheap: ~0.5 ms).
 */
import { state, computed } from './state.js';
import { computeField, barycentricOptimal, barycentricSuboptimal, runTrajectory, softmax, dot } from './math.js';

/** Max steps for the synchronous preview trajectory computed during drag. */
const PREVIEW_STEPS = 4000;

// ── Worker source (math duplicated to avoid module-in-worker complexity) ──────
// Shared math for both workers (avoids duplication)
const _MATH = `
'use strict';
const dot    = (a,b) => a.reduce((s,v,i)=>s+v*b[i], 0);
const vadd   = (a,b) => a.map((v,i)=>v+b[i]);
const vscale = (a,k) => a.map(v=>v*k);
const vnorm  = a     => Math.sqrt(a.reduce((s,v)=>s+v*v, 0));
function softmax(z){
  const mx=Math.max(...z), ex=z.map(v=>Math.exp(v-mx));
  const s=ex.reduce((a,b)=>a+b,0); return ex.map(v=>v/s);
}
function pgGrad(X,r,w){
  const pi=softmax(X.map(x=>dot(x,w)));
  const Vpi=pi.reduce((s,p,i)=>s+p*r[i],0);
  return [0,1].map(d=>pi.reduce((s,p,i)=>s+p*(r[i]-Vpi)*X[i][d],0));
}
function runTraj(X,r,w0,lr,n_steps){
  const MAX=2000, stride=Math.max(1,Math.floor(n_steps/MAX));
  const traj=[w0.slice()]; let w=w0.slice();
  for(let t=0;t<n_steps;t++){
    const g=pgGrad(X,r,w);
    if(vnorm(g)<1e-7) break;   // converged
    w=vadd(w,vscale(g,lr));
    if(!isFinite(w[0])||!isFinite(w[1])||vnorm(w)>1e6) break;
    if(t%stride===stride-1) traj.push(w.slice());
  }
  traj.push(w.slice()); return traj;
}
`;

const WORKER_SRC = _MATH + `
function baryOpt(X,r,w){
  const pi=softmax(X.map(x=>dot(x,w)));
  const mx=Math.max(...r);
  const piO=pi.map((p,i)=>r[i]===mx?p:0);
  const s=piO.reduce((a,b)=>a+b,0);
  if(s<1e-30)return null;
  const lam=piO.map(p=>p/s);
  return [0,1].map(d=>lam.reduce((s,l,i)=>s+l*X[i][d],0));
}
function barySubOpt(X,r,w){
  const pi=softmax(X.map(x=>dot(x,w)));
  const mx=Math.max(...r);
  const piS=pi.map((p,i)=>r[i]<mx?p:0);
  const s=piS.reduce((a,b)=>a+b,0);
  if(s<1e-30)return null;
  const lam=piS.map(p=>p/s);
  return [0,1].map(d=>lam.reduce((s,l,i)=>s+l*X[i][d],0));
}
function computeField(X,r,N){
  const pts=[];
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){
    const wx=-4+8*i/(N-1), wy=-4+8*j/(N-1);
    const g=pgGrad(X,r,[wx,wy]), mag=vnorm(g);
    pts.push({wx,wy,g,mag});
  }
  const mx=Math.max(...pts.map(p=>p.mag))+1e-12;
  return pts.map(p=>({...p,t:p.mag/mx}));
}
self.onmessage = function({data:{X,r,w0,lr,n_steps,withField,withBary,withBarySub,N}}){
  const field = withField ? computeField(X,r,N||22) : null;
  const traj  = runTraj(X,r,w0,lr,n_steps);
  let baryTraj = null;
  if(withBary){
    const stride=Math.max(1,Math.floor(traj.length/400));
    baryTraj=traj.filter((_,i)=>i%stride===0).map(w=>baryOpt(X,r,w));
    const last=baryOpt(X,r,traj[traj.length-1]);
    if(last) baryTraj.push(last);
  }
  let barySubTraj = null;
  if(withBarySub){
    const stride=Math.max(1,Math.floor(traj.length/400));
    barySubTraj=traj.filter((_,i)=>i%stride===0).map(w=>barySubOpt(X,r,w));
    const last=barySubOpt(X,r,traj[traj.length-1]);
    if(last) barySubTraj.push(last);
  }
  self.postMessage({field,traj,baryTraj,barySubTraj});
};
`;

// ── Main worker (field + trajectory + barycentric) ───────────────────────────
const _blob   = new Blob([WORKER_SRC],        { type: 'application/javascript' });
const _worker = new Worker(URL.createObjectURL(_blob));


let _busy      = false;
let _queued    = null;
let _onResult  = null;

_worker.onmessage = ({ data }) => {
  _busy = false;
  if (_onResult) _onResult(data);
  // Immediately start the next queued request (if any)
  if (_queued) {
    const { params, cb } = _queued;
    _queued = null;
    _dispatch(params, cb);
  }
};

function _dispatch(params, cb) {
  _busy     = true;
  _onResult = cb;
  _worker.postMessage(params);
}

/**
 * Request a (re)computation. If the worker is busy the latest request is
 * queued; when the worker finishes it will be dispatched immediately.
 * Only the most recent queued request is kept — stale ones are discarded.
 */
export function requestCompute(cb) {
  const params = {
    X:        state.X.map(x => x.slice()),
    r:        state.r.slice(),
    w0:       state.w0.slice(),
    lr:       state.lr,
    n_steps:  state.n_steps,
    withField:   state.withField,
    withBary:    state.withBary,
    withBarySub: state.withBarySub,
    N:           22,
  };
  if (_busy) {
    _queued = { params, cb };
  } else {
    _dispatch(params, cb);
  }
}

/** Fast synchronous field update — call when X/r changes during drag. */
export function syncField() {
  computed.field = state.withField
    ? computeField(state.X, state.r, 22)
    : null;
}

/**
 * Fast synchronous trajectory preview — runs min(n_steps, PREVIEW_STEPS)
 * gradient-ascent steps so the trajectory redraws immediately during drag.
 * The full computation is still dispatched to the worker afterwards.
 */
export function syncTrajectory() {
  if (!state.withSim) {
    computed.traj = null; computed.baryTraj = null; computed.barySubTraj = null; return;
  }
  const { X, r, w0, lr, n_steps, withBary, withBarySub } = state;
  const steps = Math.min(n_steps, PREVIEW_STEPS);
  computed.traj = runTrajectory(X, r, w0, lr, steps, 600);
  const stride = Math.max(1, Math.floor(computed.traj.length / 200));
  if (withBary) {
    computed.baryTraj = computed.traj
      .filter((_, i) => i % stride === 0)
      .map(w => barycentricOptimal(X, r, w));
    const last = barycentricOptimal(X, r, computed.traj[computed.traj.length - 1]);
    if (last) computed.baryTraj.push(last);
  } else {
    computed.baryTraj = null;
  }
  if (withBarySub) {
    computed.barySubTraj = computed.traj
      .filter((_, i) => i % stride === 0)
      .map(w => barycentricSuboptimal(X, r, w));
    const last = barycentricSuboptimal(X, r, computed.traj[computed.traj.length - 1]);
    if (last) computed.barySubTraj.push(last);
  } else {
    computed.barySubTraj = null;
  }
}

/** Compute the info-box text for the current final trajectory point. */
export function makeInfoText() {
  if (!computed.traj) return '—';
  const wT = computed.traj[computed.traj.length - 1];
  if (!isFinite(wT[0])) return 'Diverged — reduce η';
  const { X, r } = state;
  const pi   = softmax(X.map(x => dot(x, wT)));
  const Vpi  = pi.reduce((s, p, i) => s + p * r[i], 0);
  const bary = barycentricOptimal(X, r, wT);
  return [
    `w_T  = [${wT.map(v => v.toFixed(3)).join(', ')}]`,
    `π_T  = [${pi.map(v => v.toFixed(3)).join(', ')}]`,
    `V(π) = ${Vpi.toFixed(5)}`,
    bary ? `x̄(π) = [${bary.map(v => v.toFixed(3)).join(', ')}]` : '',
  ].filter(Boolean).join('\n');
}
