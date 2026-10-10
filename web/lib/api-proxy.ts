import type { ApiErrorResponse } from '../../shared/types.ts';
function failure(status: number, error: string) {
    const body: ApiErrorResponse = { error, asOf: null };
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Forward the app's API requests without putting provider credentials in the browser. */
export async function proxyApi(request: Request): Promise<Response> {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/')) return failure(404, 'API endpoint not found.');
    let backend: URL;
    try {
        backend = new URL(process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000');
        if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password) throw new Error();
        backend.pathname = `${backend.pathname.replace(/\/$/, '')}/${incoming.pathname.slice(5)}`;
        backend.search = incoming.search;
        backend.hash = '';
    } catch { return failure(503, 'The backend address is not configured correctly.'); }
    const headers = new Headers();
    for (const name of ['Content-Type', 'Cookie', 'X-Hedgehog-Request', 'X-Hedgehog-Session', 'Sec-Fetch-Site']) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    let upstream: Response;
    let body: Uint8Array | undefined;
    if (!['GET', 'HEAD'].includes(request.method) && request.body) {
        const reader = request.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 32 * 1024) { await reader.cancel(); return failure(413, 'Request body exceeds the supported size.'); }
                chunks.push(chunk.value);
            }
        } catch { return failure(400, 'Request body could not be read.'); }
        body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
    try {
        upstream = await fetch(backend, { method: request.method, headers,
            body: body as BodyInit | undefined,
            cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    } catch {
        return failure(502, 'Cannot reach the Hedgehog backend. Check that the backend is running and its database is reachable.');
    }
    const forwarded = new Headers({ 'Cache-Control': 'no-store' });
    for (const cookie of upstream.headers.getSetCookie()) forwarded.append('Set-Cookie', cookie);
    for (const name of ['Content-Type', 'Retry-After', 'X-Data-As-Of']) {
        const value = upstream.headers.get(name);
        if (value !== null) forwarded.set(name, value);
    }
    if (request.method === 'HEAD') return new Response(null, { status: upstream.status, headers: forwarded });
    // The only non-JSON success response in Hedgehog is the voice briefing.
    if (upstream.ok && incoming.pathname === '/api/briefing/audio' && upstream.headers.get('Content-Type')?.startsWith('audio/'))
        return new Response(upstream.body, { status: upstream.status, headers: forwarded });
    try {
        const data: unknown = await upstream.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
        forwarded.set('Content-Type', 'application/json');
        return new Response(JSON.stringify(data), { status: upstream.status, headers: forwarded });
    } catch {
        const body: ApiErrorResponse = { error: `Hedgehog backend returned an invalid response (HTTP ${upstream.status}). Check the backend connection and server logs.`, asOf: null };
        forwarded.set('Content-Type', 'application/json');
        return new Response(JSON.stringify(body), { status: 502, headers: forwarded });
    }
}
