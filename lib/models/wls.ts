import { solve } from "./logistic";

/** One observation of a sparse linear model: y ≈ Σ coef × x[param]. */
export interface SparseObs {
  y: number;
  w: number;
  terms: [param: number, x: number][];
}

/**
 * Weighted least squares with a small ridge penalty, accumulating the normal equations from
 * sparse rows (each observation touches only a few parameters).
 */
export function fitSparseWls(obs: SparseObs[], nParams: number, ridge = 1e-6): number[] {
  const A = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
  const b = new Array(nParams).fill(0);
  for (const o of obs) {
    for (const [i, xi] of o.terms) {
      b[i] += o.w * xi * o.y;
      for (const [j, xj] of o.terms) A[i][j] += o.w * xi * xj;
    }
  }
  for (let i = 0; i < nParams; i++) A[i][i] += ridge;
  return solve(A, b);
}
