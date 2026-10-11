import type { ForecastRange, ValueForecast } from '../../../shared/types.ts';

export const FORECAST_TRAIN_DAYS = 60;
const SELECTION_DAYS = 40;
export const MIN_FORECAST_RETURNS = FORECAST_TRAIN_DAYS + SELECTION_DAYS + 20;
export const cents = (value: number) => Math.round(value * 100) / 100;
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const mse = (values: number[]) => mean(values.map(v => v * v));

export function quantile(values: number[], probability: number): number {
    if (!values.length || values.some(v => !Number.isFinite(v)) || !Number.isFinite(probability) || probability < 0 || probability > 1)
        throw new Error('Invalid quantile data');
    const sorted = [...values].sort((a, b) => a - b), index = probability * (sorted.length - 1);
    const low = Math.floor(index), fraction = index - low;
    return sorted[low] + fraction * (sorted[Math.ceil(index)] - sorted[low]);
}

/** Fixed current portfolio weights; each observation covers exactly one stored SPY session.
 * Model choice uses an earlier selection window. The final audit window is never used to
 * choose the model, and every rolling forecast sees only the preceding returns.
 */
export function valueForecast(returns: number[], coveredValue: number): Pick<ValueForecast,
    'method' | 'predictedValue' | 'changeUsd' | 'estimated80Range' | 'observations' | 'validation' | 'notes'> {
    const empty = { method: null, predictedValue: null, changeUsd: null, estimated80Range: null,
        observations: returns.length, validation: null,
        notes: [`A value forecast needs at least ${MIN_FORECAST_RETURNS} aligned daily returns, including an independent validation window.`] };
    if (!Number.isFinite(coveredValue) || coveredValue <= 0 || returns.length < MIN_FORECAST_RETURNS || returns.some(r => !Number.isFinite(r) || r <= -1))
        return empty;
    const auditDays = Math.min(60, returns.length - FORECAST_TRAIN_DAYS - SELECTION_DAYS);
    const auditStart = returns.length - auditDays, selectionStart = auditStart - SELECTION_DAYS;
    const predicted = (i: number) => mean(returns.slice(i - FORECAST_TRAIN_DAYS, i));
    const selection = returns.slice(selectionStart, auditStart);
    const meanErrors = selection.map((r, i) => r - predicted(selectionStart + i));
    const method = mse(meanErrors) < mse(selection) ? 'rolling-mean' : 'no-change';
    const audit = returns.slice(auditStart);
    const errors = audit.map((r, i) => r - (method === 'rolling-mean' ? predicted(auditStart + i) : 0));
    const estimate = method === 'rolling-mean' ? predicted(returns.length) : 0;
    const predictedValue = cents(coveredValue * (1 + estimate));
    const range: ForecastRange = {
        low: cents(coveredValue * (1 + estimate + quantile(errors, 0.1))),
        high: cents(coveredValue * (1 + estimate + quantile(errors, 0.9)))
    };
    const validation = { days: auditDays, rmseUsd: cents(Math.sqrt(mse(errors)) * coveredValue),
        noChangeRmseUsd: cents(Math.sqrt(mse(audit)) * coveredValue) };
    if (![predictedValue, range.low, range.high, validation.rmseUsd, validation.noChangeRmseUsd].every(Number.isFinite))
        return { ...empty, notes: ['The stored history produces invalid numeric estimates; no forecast is shown.'] };
    return { method, predictedValue, changeUsd: cents(predictedValue - coveredValue),
        estimated80Range: range.low >= 0 ? range : null, observations: returns.length, validation,
        notes: [method === 'no-change'
            ? 'A rolling historical mean did not beat no change in the earlier model-selection window. The point forecast therefore stays at the entered value.'
            : 'The preceding 60-session average return beat no change in the earlier model-selection window.',
        'The estimated 80% range uses the final held-out forecast errors. Its future coverage is unverified; it assumes those errors remain representative.',
        ...(validation.rmseUsd > validation.noChangeRmseUsd ? ['The selected model underperformed no change in the independent validation window. There is no demonstrated forecasting advantage.'] : [])] };
}
