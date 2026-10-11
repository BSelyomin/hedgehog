import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { BrokerageMode } from '../../../shared/types.ts';

export class BrokerageError extends Error {
    status: number;
    constructor(message: string, status = 503) { super(message); this.status = status; }
}
export const mode = (): BrokerageMode => process.env.SNAPTRADE_MODE === 'live' ? 'live' : 'sandbox';
export function configuration() {
    const clientId = process.env.SNAPTRADE_CLIENT_ID ?? '';
    const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY ?? '';
    const encodedKey = process.env.SNAPTRADE_ENCRYPTION_KEY ?? '';
    const key = Buffer.from(encodedKey, 'base64');
    const appUrl = process.env.APP_URL ?? '';
    let validUrl = false;
    try {
        const url = new URL(appUrl);
        validUrl = !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
            (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
    } catch { /* Invalid configuration remains disabled. */ }
    const validMode = !process.env.SNAPTRADE_MODE || ['sandbox', 'live'].includes(process.env.SNAPTRADE_MODE);
    const configured = Boolean(clientId && consumerKey && key.length === 32 && key.toString('base64') === encodedKey && validUrl && validMode);
    return { configured, clientId, consumerKey, key, appUrl, clientHash: createHash('sha256').update(clientId).digest('hex') };
}
function requiredConfig() {
    const config = configuration();
    if (!config.configured) throw new BrokerageError('SnapTrade is not configured. Manual entry and CSV uploads are available.');
    return config;
}
export function encryptSecret(secret: string, owner: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', requiredConfig().key, iv);
    cipher.setAAD(Buffer.from(owner));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
}
export function decryptSecret(encrypted: string, owner: string): string {
    try {
        const [iv, tag, ciphertext] = encrypted.split('.').map(s => Buffer.from(s, 'base64'));
        const decipher = createDecipheriv('aes-256-gcm', requiredConfig().key, iv);
        decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { throw new BrokerageError('Stored brokerage credentials cannot be decrypted. Restore the original encryption key.'); }
}
export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
export function signature(path: string, query: string, content: Record<string, unknown> | null, key: string): string {
    return createHmac('sha256', key).update(canonical({ content: content && Object.keys(content).length ? content : null, path, query })).digest('base64');
}
export interface Credentials { userId: string; userSecret: string }
/** Only these data-access operations are allowed; no trading API can be called. */
function permitted(method: string, path: string): boolean {
    return method === 'GET' && (['/accounts', '/authorizations'].includes(path) || /^\/accounts\/[a-f0-9-]{36}\/(positions\/all|activities)$/.test(path)) ||
        method === 'POST' && ['/snapTrade/registerUser', '/snapTrade/login'].includes(path) ||
        method === 'DELETE' && /^\/connection\/[a-f0-9-]{36}$/.test(path);
}
export async function snaptrade(method: 'GET' | 'POST' | 'DELETE', endpoint: string, credentials?: Credentials, body?: Record<string, unknown>, pagination: { offset: number; limit: number } | null = null): Promise<unknown> {
    if (!permitted(method, endpoint)) throw new BrokerageError('Unsupported brokerage operation', 400);
    if (pagination && (!endpoint.endsWith('/activities') || !Number.isSafeInteger(pagination.offset) || pagination.offset < 0 || !Number.isSafeInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 1000))
        throw new BrokerageError('Invalid transaction pagination', 400);
    const config = requiredConfig();
    const path = `/api/v1${endpoint}`;
    const params = new URLSearchParams({ clientId: config.clientId, timestamp: String(Math.floor(Date.now() / 1000)), ...credentials });
    if (pagination) { params.set('offset', String(pagination.offset)); params.set('limit', String(pagination.limit)); }
    const query = params.toString(), content = body ?? null;
    let response: Response;
    try {
        response = await fetch(`https://api.snaptrade.com${path}?${query}`, {
            method, headers: { 'Content-Type': 'application/json', Signature: signature(path, query, content, config.consumerKey) },
            body: body ? canonical(body) : undefined, signal: AbortSignal.timeout(30_000), redirect: 'error',
        });
    } catch { throw new BrokerageError('SnapTrade could not be reached. Try again later.'); }
    // Never surface provider bodies or request URLs: they may contain secrets.
    if (!response.ok) throw new BrokerageError(response.status === 429 ? 'SnapTrade rate limit reached. Try again later.' : 'SnapTrade rejected the request. Check API key setup or reconnect the brokerage.');
    if (method === 'DELETE') { await response.body?.cancel(); return null; }
    try { return await response.json(); } catch { throw new BrokerageError('SnapTrade returned invalid data. Previous holdings were preserved.'); }
}
