// Normalize numeric tokens, but never invent percentage/unit conversions.
export function numericTokens(text: string): string[] { return (text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').match(/[-+−]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(v => String(Number(v.replace('−', '-')))); }
export function numbersSupported(text: string, input: unknown): boolean {
    const allowed = new Set(numericTokens(JSON.stringify(input)));
    return numericTokens(text).every(n => allowed.has(n));
}
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
