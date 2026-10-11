// Normalize numeric tokens, but never invent percentage/unit conversions.
export function numericTokens(text: string): string[] { return (text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').match(/[-+−]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(v => String(Number(v.replace('−', '-')))); }
export function numbersSupported(text: string, input: unknown): boolean {
    const allowed = new Set(numericTokens(JSON.stringify(input)));
    return numericTokens(text).every(n => allowed.has(n));
}
// A figure written out in words, which the number check above cannot read: "thirteen point eight
// million", "ten percent", "twenty twenty-six". Asked to use no digits, a model wrote exactly these
// (2026-10-10). Text that does so is treated as stating an unchecked number. A plain count or a
// term such as "two-year yield" or "thirty-year mortgage" is not a figure and is left alone.
const NUMBER_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
const TENS = '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
const SPELLED = new RegExp(`\\b${NUMBER_WORD}(?:[- ]${NUMBER_WORD})*[- ](?:hundred|thousand|million|billion|trillion|percent|per cent|percentage)\\b`
    + `|\\b${NUMBER_WORD}[- ]point[- ]${NUMBER_WORD}\\b|\\b${TENS}[- ]${TENS}\\b|\\b(?:hundreds|thousands|millions|billions|trillions) of\\b`, 'i');
export function spelledFigure(text: string): boolean { return SPELLED.test(text); }
export function safeSources(sources: {
    title: string;
    url: string;
}[]) { return sources.filter(s => { try {
    return ['https:', 'http:'].includes(new URL(s.url).protocol);
}
catch {
    return false;
} }); }
export function validTags(input: unknown, allowed: string[]): string[] { return Array.isArray(input) ? [...new Set(input.filter((t): t is string => typeof t === 'string' && allowed.includes(t)))] : []; }
