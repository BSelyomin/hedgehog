let sessionKey: string | null = null;
const forecastResponses = new Map<string, { value: unknown; until: number }>();
const forecastRequests = new Map<string, Promise<unknown>>();
let forecastRevision = 0;
function clearForecastResponses() { forecastRevision++; forecastResponses.clear(); forecastRequests.clear(); }
export function setSessionKey(value: string) { if (sessionKey !== value) clearForecastResponses(); sessionKey = value; }

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
        if (typeof window !== 'undefined' &&
            ((response.status === 401 && !['/auth/signin', '/auth/signup', '/auth/session'].includes(path)) || response.status === 409 && message.includes('session changed')))
            window.dispatchEvent(new Event('hedgehog-session-changed'));
        throw new Error(message);
    }
    return data as T;
}
export async function api<T>(path: string, options?: RequestInit, timeoutMs = options?.method && options.method !== 'GET' ? 90000 : 30000): Promise<T> {
    const method = options?.method ?? 'GET';
    if (method !== 'GET' || !path.startsWith('/forecasts')) {
        const value = await requestAPI<T>(path, options, timeoutMs);
        if (method !== 'GET') clearForecastResponses();
        return value;
    }
    const cached = forecastResponses.get(path);
    if (options?.cache !== 'reload' && cached && cached.until > Date.now()) return structuredClone(cached.value) as T;
    let request = forecastRequests.get(path);
    if (!request) {
        const revision = forecastRevision;
        // Consumers may unmount independently; the shared request retains its own
        // timeout while useData ignores replies to its aborted consumer signal.
        request = requestAPI<unknown>(path, { ...options, signal: undefined }, timeoutMs).then(value => {
            const data = value as { status?: string; assessments?: { assessment: { status: string } }[] };
            const pending = data.status === 'pending' || data.assessments?.some(item => item.assessment.status === 'pending');
            if (!pending && revision === forecastRevision) forecastResponses.set(path, { value: structuredClone(value), until: Date.now() + 60000 });
            return value;
        });
        forecastRequests.set(path, request);
        const current = request;
        void request.finally(() => { if (forecastRequests.get(path) === current) forecastRequests.delete(path); }).catch(() => {});
    }
    return structuredClone(await request) as T;
}

async function requestAPI<T>(path: string, options: RequestInit | undefined, timeoutMs: number): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Hedgehog-Request', '1');
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
