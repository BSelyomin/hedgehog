import { DRIVERS } from '../config/drivers.ts';
import type { EventCandidate } from './event-predictions.ts';
import { driverLabels } from './forecast-model.ts';

export interface ForecastGroup extends EventCandidate { members: EventCandidate[]; groupKey: string }

// Grouping is presentation/context only. Title recognition never grants a numeric
// driver mapping: predictEventResult still requires a verified levelSeries.
function isSPLevel(event: EventCandidate): boolean {
    const title = event.title.normalize('NFKC');
    const subject = title.match(/\b(?:s\s*(?:&|and)\s*p|standard\s*(?:&|and)\s*poor[’']?s)(?:\s*(\d+))?\b/i);
    return !/nasdaq|dow|russell/i.test(event.seriesTicker) && Boolean(subject) && (!subject?.[1] || subject[1] === '500')
        && /\b(?:price|odds|range|level|above|below|over|under|up|down|close|closing|finish|reach|hit|high|low|value|at|on|by)\b/i.test(title)
        && !/\b(?:mention|join|added|addition|removed|removal|earnings call|S&P Global)\b/i.test(title);
}

/** Retain the subject/metric; remove varying dates, times and numeric targets.
 * Series identity prevents unrelated metrics from merging. Tenors stay distinct.
 */
export function forecastFormat(title: string): string {
    const subjects: string[] = [];
    return title.normalize('NFKC')
        .replace(/\b(?:\d+\s*[- ]?\s*(?:year|yr|month|mo|week|day)s?|(?:s\s*(?:&|and)\s*p|standard\s*(?:&|and)\s*poor[’']?s|nasdaq|russell|ftse|nikkei)\s*\d+)\b/gi, word => {
            subjects.push(word); return `SUBJECT${subjects.length - 1}TOKEN`;
        })
        .replace(/\b(?:on|at|by|before|after)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?:\s*(?:ET|EST|EDT|UTC))?\b/gi, '')
        .replace(/\b(?:on|for|by)?\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, '')
        .replace(/\b(?:on|for|by)?\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi, '')
        .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi, '')
        .replace(/\b(?:today|tomorrow|tonight|this\s+(?:week|month|year)|next\s+(?:week|month|year))\b/gi, '')
        .replace(/\b\d{1,2}:\d{2}(?:\s*(?:ET|EST|EDT|UTC))?\b/gi, '')
        .replace(/(?<![\w])\$?\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th)?%?(?![\w])/g, '…')
        .replace(/SUBJECT(\d+)TOKEN/g, (_, index: string) => subjects[Number(index)])
        .replace(/\s+/g, ' ').replace(/\s+([?!])/g, '$1').trim();
}

/** One entry per underlying/format across times and thresholds, never shared tags alone. */
export function groupForecastCandidates(candidates: EventCandidate[]): ForecastGroup[] {
    const groups = new Map<string, EventCandidate[]>();
    for (const event of candidates) {
        const driver = DRIVERS.find(d => d.levelSeries?.includes(event.seriesTicker));
        const normalized = forecastFormat(event.title).toLowerCase();
        const key = driver ? `level:${driver.key}` : isSPLevel(event) ? 'level:SPY'
            : `format:${event.seriesTicker}:${normalized}`;
        const members = groups.get(key) ?? []; members.push(event); groups.set(key, members);
    }
    return [...groups].map(([groupKey, rows]) => {
        const members = [...rows].sort((a, b) => a.closeTime.localeCompare(b.closeTime) || a.ticker.localeCompare(b.ticker));
        const first = members[0], driver = DRIVERS.find(d => groupKey === `level:${d.key}`);
        return { ...first, groupKey, members,
            title: driver ? driver.levelReference?.label ?? driverLabels[driver.key] ?? first.title
                : members.length > 1 ? forecastFormat(first.title) : first.title,
            tags: [...new Set(members.flatMap(e => e.tags))].sort(), linkedSymbols: [...new Set(members.flatMap(e => e.linkedSymbols))].sort() };
    });
}
