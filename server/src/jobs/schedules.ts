// Vercel evaluates schedules in UTC. Two possible UTC hours plus an Eastern
// hour check preserve the existing daily schedule through daylight saving time.
export const schedules = [
    { id: 'poll', job: 'poll', cron: '*/5 * * * *' },
    { id: 'nightly', job: 'nightly', cron: '30 2,3 * * *', easternHour: 22 },
    { id: 'track-record', job: 'track-record', cron: '45 2,3 * * *', easternHour: 22 },
    { id: 'briefings-morning', job: 'briefings', cron: '0 12,13 * * *', easternHour: 8 },
    { id: 'enrich', job: 'enrich', cron: '0 * * * *' },
    { id: 'session-cleanup', job: 'session-cleanup', cron: '15 * * * *' },
    { id: 'brokerages', job: 'brokerages', cron: '20 * * * *' },
    { id: 'briefings', job: 'briefings', cron: '15 * * * *' },
    { id: 'odds-candles-hourly', job: 'odds-candles-hourly', cron: '5 * * * *' },
    { id: 'odds-candles-daily', job: 'odds-candles-daily', cron: '20 4,5 * * *', easternHour: 0 },
    { id: 'price-history', job: 'price-history', cron: '10 * * * *' },
    { id: 'earnings-dates', job: 'earnings-dates', cron: '30 2,3 * * *', easternHour: 22 },
] as const;

export function scheduleDue(schedule: { id: string; easternHour?: number }, at = new Date()): boolean {
    if (schedule.easternHour === undefined) return true;
    const hour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
    }).format(at));
    return hour === schedule.easternHour;
}
