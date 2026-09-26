export interface LogitModel {
  names: string[];
  mean: number[];
  sd: number[];
  intercept: number;
  coef: number[];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Solves A x = b for a small symmetric positive-definite A (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Logistic regression by Newton-Raphson (IRLS) on standardized features with a small ridge
 * penalty. `X` is row-major with `k` features per row.
 */
export function fitLogistic(
  X: Float64Array,
  y: Uint8Array,
  names: string[],
  opts: { l2?: number; maxIter?: number; tol?: number } = {}
): LogitModel {
  const k = names.length;
  const n = y.length;
  const l2 = opts.l2 ?? 1e-4 * n;
  const mean = new Array(k).fill(0);
  const sd = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) mean[j] += X[i * k + j] / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) sd[j] += (X[i * k + j] - mean[j]) ** 2 / n;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;

  const d = k + 1; // intercept first
  const beta = new Array(d).fill(0);
  const rate = y.reduce((s, v) => s + v, 0) / n;
  beta[0] = Math.log(rate / (1 - rate));
  const z = new Float64Array(d);

  for (let iter = 0; iter < (opts.maxIter ?? 30); iter++) {
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    const g = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      z[0] = 1;
      for (let j = 0; j < k; j++) z[j + 1] = (X[i * k + j] - mean[j]) / sd[j];
      let eta = 0;
      for (let j = 0; j < d; j++) eta += beta[j] * z[j];
      const p = sigmoid(eta);
      const w = p * (1 - p);
      const r = y[i] - p;
      for (let a = 0; a < d; a++) {
        g[a] += z[a] * r;
        const wa = w * z[a];
        for (let b = a; b < d; b++) H[a][b] += wa * z[b];
      }
    }
    for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    for (let a = 1; a < d; a++) {
      H[a][a] += l2;
      g[a] -= l2 * beta[a];
    }
    const step = solve(H, g);
    let maxStep = 0;
    for (let j = 0; j < d; j++) {
      beta[j] += step[j];
      maxStep = Math.max(maxStep, Math.abs(step[j]));
    }
    if (maxStep < (opts.tol ?? 1e-7)) break;
  }
  return { names, mean, sd, intercept: beta[0], coef: beta.slice(1) };
}

export function predictLogistic(m: LogitModel, x: ArrayLike<number>): number {
  let eta = m.intercept;
  for (let j = 0; j < m.coef.length; j++) eta += (m.coef[j] * (x[j] - m.mean[j])) / m.sd[j];
  return sigmoid(eta);
}

export function logLoss(p: ArrayLike<number>, y: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const q = Math.min(1 - 1e-12, Math.max(1e-12, p[i]));
    s -= y[i] ? Math.log(q) : Math.log(1 - q);
  }
  return s / y.length;
}

/** Rank-based AUC (Mann-Whitney U). */
export function auc(p: ArrayLike<number>, y: ArrayLike<number>): number {
  const idx = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[a] - p[b]);
  let rankSum = 0;
  let pos = 0;
  for (let r = 0; r < idx.length; ) {
    let e = r;
    while (e + 1 < idx.length && p[idx[e + 1]] === p[idx[r]]) e++;
    const avgRank = (r + e) / 2 + 1;
    for (let t = r; t <= e; t++) if (y[idx[t]]) {
      rankSum += avgRank;
      pos++;
    }
    r = e + 1;
  }
  const neg = y.length - pos;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Calibration table: equal-count bins of predicted probability. */
export function calibration(p: ArrayLike<number>, y: ArrayLike<number>, bins = 10) {
  const idx = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[a] - p[b]);
  const out: { bin: number; n: number; predicted: number; observed: number }[] = [];
  for (let b = 0; b < bins; b++) {
    const slice = idx.slice(Math.floor((b * idx.length) / bins), Math.floor(((b + 1) * idx.length) / bins));
    const pred = slice.reduce((s, i) => s + p[i], 0) / slice.length;
    const obs = slice.reduce((s, i) => s + y[i], 0) / slice.length;
    out.push({ bin: b + 1, n: slice.length, predicted: pred, observed: obs });
  }
  return out;
}
