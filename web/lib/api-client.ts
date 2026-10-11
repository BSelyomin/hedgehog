let sessionKey: string | null = null;
const responses = new Map<string, { value: unknown; until: number }>();
const requests = new Map<string, { promise: Promise<unknown>; refresh: boolean }>();
const PAGE_CACHE_MS = 5 * 60_000;
const MAX_CACHED_RESPONSES = 200;
let revision = 0;

function cacheKey(path: string) {
    const url = new URL(path, 'http://hedgehog.local');
    url.searchParams.sort();
    return url.pathname + url.search;
}
function cacheLifetime(path: string) {
    // Session checks must see cookie changes, including sign-out in another tab.
    if (path.startsWith('/auth/')) return 0;
    return path === '/health' ? 30_000 : PAGE_CACHE_MS;
}
function clearResponses() { revision++; responses.clear(); requests.clear(); }
export function setSessionKey(value: string) { if (sessionKey !== value) clearResponses(); sessionKey = value; }
export function getCacheOwner() { return sessionKey; }
export function invalidateCachedResponses(prefix: string) {
    for (const key of responses.keys()) if (key.startsWith(prefix)) responses.delete(key);
    for (const key of requests.keys()) if (key.startsWith(prefix)) requests.delete(key);
}

/** Private, bounded memory cache; never persisted to disk or shared through HTTP caches. */
export function getCachedResponse<T>(path: string): T | null {
    const key = cacheKey(path), cached = responses.get(key);
    if (!cached) return null;
    if (cached.until <= Date.now()) { responses.delete(key); return null; }
    responses.delete(key); responses.set(key, cached);
    return structuredClone(cached.value) as T;
}
export function cacheResponse(path: string, value: unknown, expectedSessionKey = sessionKey) {
    if (expectedSessionKey !== sessionKey) return;
    const key = cacheKey(path), lifetime = cacheLifetime(key);
    const data = value as { status?: string; assessments?: { assessment: { status: string } }[] };
    // Running AI jobs need another status read; stopped/unavailable jobs are terminal.
    const pending = data.status === 'pending' || data.assessments?.some(item => item.assessment.status === 'pending');
    responses.delete(key);
    if (!lifetime || pending) return;
    responses.set(key, { value: structuredClone(value), until: Date.now() + lifetime });
    if (responses.size > MAX_CACHED_RESPONSES) responses.delete(responses.keys().next().value!);
}

/** Cancelling a page's read does not cancel work shared with another page. */
function consume<T>(request: Promise<unknown>, signal?: AbortSignal | null): Promise<T> {
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
        request.then(value => {
            cleanup();
            if (!signal?.aborted) {
                try { resolve(structuredClone(value) as T); } catch (error) { reject(error); }
            }
        }, error => { cleanup(); reject(error); });
    });
}

/** Parse responses defensively: a failed proxy may return text/HTML instead of our JSON contract. */
export async function readApiResponse<T>(response: Response, path: string): Promise<T> {
    let data: unknown;
    try { data = await response.json(); }
    catch {
        throw new Error(`Hedgehog API returned a non-JSON response (HTTP ${response.status}). Check that the backend is running and reachable.`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error(`Hedgehog API returned an unexpected response (HTTP ${response.status}). Check the backend connection.`);
    const error = (data as { error?: unknown }).error;
    if (!response.ok) {
        const message = typeof error === 'string' ? error : `Hedgehog request failed (HTTP ${response.status}).`;
        if ((response.status === 401 && !['/auth/signin', '/auth/signup', '/auth/session'].includes(path)) || response.status === 409 && message.includes('session changed')) {
            clearResponses();
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('hedgehog-session-changed'));
        }
        throw new Error(message);
    }
    return data as T;
}
export async function api<T>(path: string, options?: RequestInit, timeoutMs = options?.method && options.method !== 'GET' ? 90000 : 30000): Promise<T> {
    const method = (options?.method ?? 'GET').toUpperCase();
    options?.signal?.throwIfAborted();
    if (method !== 'GET') {
        // These POSTs only calculate a user-entered scenario; they do not save it
        // or change the portfolio, so existing page reads remain valid.
        if (method === 'POST' && (path === '/forecasts/scenario' || path === '/forecasts/event' || /^\/forecasts\/result\/[^/]+$/.test(path)))
            return requestAPI<T>(path, options, timeoutMs);
        // Invalidate both sides of a write: reads started before/during it must not
        // repopulate the cache, even if a connection fails after the write succeeds.
        clearResponses();
        try { return await requestAPI<T>(path, options, timeoutMs); }
        finally { clearResponses(); }
    }
    const key = cacheKey(path);
    if (!cacheLifetime(key) || options?.cache === 'no-store' || options?.headers || options?.body)
        return requestAPI<T>(path, options, timeoutMs);
    if (options?.cache !== 'reload') {
        const cached = getCachedResponse<T>(path);
        if (cached !== null) return cached;
    } else responses.delete(key);
    let entry = requests.get(key);
    const refresh = options?.cache === 'reload';
    if (!entry || refresh && !entry.refresh) {
        const startedAtRevision = revision;
        const request = requestAPI<unknown>(path, { ...options, signal: undefined }, timeoutMs).then(value => {
            if (startedAtRevision === revision && requests.get(key) === current) cacheResponse(path, value);
            return value;
        });
        const current = { promise: request, refresh };
        requests.set(key, current);
        entry = current;
        void request.finally(() => { if (requests.get(key) === current) requests.delete(key); }).catch(() => {});
    }
    return consume<T>(entry.promise, options?.signal);
}

async function requestAPI<T>(path: string, options: RequestInit | undefined, timeoutMs: number): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Hedgehog-Request', '1');
    if (options?.cache === 'reload') headers.set('X-Hedgehog-Refresh', '1');
    if (sessionKey) headers.set('X-Hedgehog-Session', sessionKey);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (options?.signal?.aborted) cancel();
    else options?.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const response = await fetch(`/api${path}`, { ...options, signal: controller.signal, headers,
            credentials: 'same-origin', cache: 'no-store' });
        return await readApiResponse<T>(response, path);
    } catch (error) {
        if (timedOut) throw new Error('The request timed out. Select Reload to retry. Check the backend and database connection if it continues.');
        throw error;
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', cancel);
    }
}
