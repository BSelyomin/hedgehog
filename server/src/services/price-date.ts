// Daily Yahoo candles can contain a partial current session. Allow one hour
// after the regular US close before treating today's candle as a daily close.
// Weekends/holidays are resolved from stored observations, not a guessed calendar.
// The regular US close on a date: 4:00 pm in New York, which is four or five hours behind UTC.
export function closeInstant(date: string): Date {
    const hour = (utc: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${date}T${utc}:00:00Z`)));
    return new Date(`${date}T${hour(20) === 16 ? 20 : 21}:00:00Z`);
}
export function completedPriceDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    return Number(part('hour')) >= 17 ? date : new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
}
