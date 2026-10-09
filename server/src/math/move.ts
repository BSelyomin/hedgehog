export function splitMove(actual: number, b: number, spyReturn: number, value: number) {
    const actualCents = Math.round(actual * 100);
    const marketCents = Math.round(b * spyReturn * value * 100);
    return { actual: actualCents / 100, fromMarket: marketCents / 100, beyondMarket: (actualCents - marketCents) / 100 };
}
