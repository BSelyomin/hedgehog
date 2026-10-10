export function splitMove(actual: number, b: number, spyReturn: number, value: number) {
    const actualCents = Math.round(actual * 100);
    const marketCents = Math.round(b * spyReturn * value * 100);
    return { actual: actualCents / 100, fromMarket: marketCents / 100, beyondMarket: (actualCents - marketCents) / 100 };
}
// One driver's estimated part of a holding's move: sensitivity x the driver's change x the holding's value.
export function driverContribution(b: number, change: number, value: number) {
    return Math.round(b * change * value * 100) / 100;
}
// Largest first by size, whichever direction: the first entry is what mattered most.
export function rankMoves<T extends { driver: string; contribution: number }>(moves: T[]): T[] {
    return [...moves].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.driver.localeCompare(b.driver));
}
// Adds up each driver's estimates across holdings, in whole cents.
export function sumByDriver(moves: { driver: string; contribution: number }[]) {
    const cents = new Map<string, number>();
    for (const move of moves)
        cents.set(move.driver, (cents.get(move.driver) ?? 0) + Math.round(move.contribution * 100));
    return rankMoves([...cents].map(([driver, total]) => ({ driver, contribution: total / 100 })));
}
