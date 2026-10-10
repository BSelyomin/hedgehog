let sessionKey: string | null = null;
export function setSessionKey(value: string) { sessionKey = value; }

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
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Hedgehog-Request', '1');
    if (sessionKey) headers.set('X-Hedgehog-Session', sessionKey);
    const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    return readApiResponse<T>(response, path);
}
