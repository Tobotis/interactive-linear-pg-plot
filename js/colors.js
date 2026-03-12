// Matplotlib Set2 (8 colors)
export const SET2 = [
  '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3',
  '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3',
];

export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Blues_r clipped to matplotlib range [0.35, 1.0]
const BLUES = [
  [0.35, [190, 217, 235]],
  [0.50, [147, 195, 223]],
  [0.65, [ 87, 162, 207]],
  [0.80, [ 33, 113, 181]],
  [1.00, [  8,  48, 107]],
];

/** t ∈ [0,1] → CSS rgb() string from the Blues colormap. */
export function blueColor(t) {
  const s = 0.35 + t * 0.65;
  for (let i = 0; i < BLUES.length - 1; i++) {
    const [t0, c0] = BLUES[i], [t1, c1] = BLUES[i + 1];
    if (s <= t1) {
      const f = (s - t0) / (t1 - t0);
      return `rgb(${lerp(c0[0],c1[0],f)},${lerp(c0[1],c1[1],f)},${lerp(c0[2],c1[2],f)})`;
    }
  }
  return 'rgb(8,48,107)';
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
