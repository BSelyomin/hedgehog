import { createHash } from 'node:crypto';
import { isObject } from './snowflake.ts';

export interface SearchDocument {
    id: string;
    title: string;
    url: string;
    text: string;
    publishedAt: string;
    feedUrl: string;
}

export function validateSearchDocuments(input: unknown, now = new Date()): SearchDocument[] {
    if (!Array.isArray(input) || !input.length || input.length > 500)
        throw new Error('Provide between 1 and 500 source documents');
    const seen = new Set<string>();
    return input.map(row => {
        if (!isObject(row) || !['title', 'url', 'text', 'publishedAt', 'feedUrl'].every(k => typeof row[k] === 'string' && row[k].trim()))
            throw new Error('Each source needs title, url, text, publishedAt and feedUrl');
        const { title, text, publishedAt, feedUrl } = row as Record<string, string>;
        const url = new URL(row.url as string);
        const feed = new URL(feedUrl);
        if ([url, feed].some(u => u.protocol !== 'https:' || u.username || u.password) || seen.has(url.href))
            throw new Error('Sources require unique HTTPS URLs without credentials');
        const date = new Date(publishedAt);
        const age = now.getTime() - date.getTime();
        if (!Number.isFinite(age) || age < -86400000 || age > 90 * 86400000 || text.length > 12000 || title.length > 1000)
            throw new Error('Source dates must be within 90 days and passages at most 12000 characters');
        seen.add(url.href);
        return { id: createHash('sha256').update(url.href).digest('hex'), title: title.trim(),
            url: url.href, text: text.trim(), publishedAt: date.toISOString(), feedUrl: feed.href };
    });
}

export function searchIdentifier(value: string): string {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(value))
        throw new Error('Search setup identifiers must be uppercase letters, digits and underscores');
    return value;
}
