import type { Sensitivity } from '../../../shared/types';

// How each measured driver reads in a sentence, and the size of driver move the sentence uses.
// b is the stock's return per unit of driver change: per 1.00 return for oil and SPY, and per
// one percentage point of yield for DGS2 (see server/src/jobs/measure.ts).
const drivers: Record<string, { name: string; step: number; stepText: string; control: boolean }> = {
    'CL=F': { name: 'crude oil futures', step: 0.01, stepText: '1%', control: true },
    'DGS2': { name: 'the 2-year Treasury yield', step: 0.1, stepText: '0.10 percentage points', control: true },
    'SPY': { name: 'the S&P 500 (SPY)', step: 0.01, stepText: '1%', control: false },
};

// Restates the measured coefficient and its 95% range in everyday terms. Nothing here is a new
// estimate: every figure is b, low or high multiplied by the step above. Unknown drivers get no sentence.
export function describeSensitivity(symbol: string, sensitivity: Sensitivity): string | null {
    const driver = drivers[sensitivity.driver];
    if (!driver)
        return null;
    const values = [sensitivity.b, sensitivity.low, sensitivity.high].map(value => value * driver.step * 100);
    if (!values.every(Number.isFinite) || !Number.isInteger(sensitivity.days))
        return null;
    const [move, low, high] = values;
    const digits = Math.abs(move) < 0.1 ? 3 : 2;
    const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}%`;
    return `On days ${driver.name} rose ${driver.stepText}, ${symbol} ${move < 0 ? 'fell' : 'rose'} ${Math.abs(move).toFixed(digits)}% on average`
        + `${driver.control ? ', after accounting for the overall market' : ''}. `
        + `The 95% range is ${signed(low)} to ${signed(high)}, measured over ${sensitivity.days.toLocaleString('en-US')} trading days.`;
}
