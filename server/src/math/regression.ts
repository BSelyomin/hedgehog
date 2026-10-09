import { Matrix, inverse, solve } from 'ml-matrix';
export function estimateSensitivity(y: number[], x: number[], controls?: number[]) {
    const k = controls ? 3 : 2;
    if (y.length !== x.length || (controls && controls.length !== y.length) || y.length <= k || [...y, ...x, ...(controls ?? [])].some(n => !Number.isFinite(n)))
        throw new Error('Invalid aligned regression data');
    const X = new Matrix(y.map((_, i) => controls ? [1, x[i], controls[i]] : [1, x[i]]));
    const Y = Matrix.columnVector(y);
    const coef = solve(X, Y, true);
    const residual = Y.sub(X.mmul(coef));
    const rss = residual.to1DArray().reduce((s: number, v: number) => s + v * v, 0);
    const covariance = inverse(X.transpose().mmul(X)).mul(rss / (y.length - k));
    const b = coef.get(1, 0), se = Math.sqrt(covariance.get(1, 1));
    if (!Number.isFinite(b) || !Number.isFinite(se))
        throw new Error('Singular regression');
    return { b, se };
}
export function beta(stockReturns: number[], spyReturns: number[]) { return estimateSensitivity(stockReturns, spyReturns).b; }
