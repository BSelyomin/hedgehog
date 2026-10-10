// Daily Yahoo candles can contain a partial current session. Allow one hour
// after the regular US close before treating today's candle as a daily close.
// Weekends/holidays are resolved from stored observations, not a guessed calendar.
export function completedPriceDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    return Number(part('hour')) >= 17 ? date : new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
}
