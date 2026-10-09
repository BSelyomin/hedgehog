import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { Express } from 'express';

/** Exercise Express, including its JSON parser, without binding a network port. */
export function request(app: Express, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return new Promise<{ status: number; headers: ReturnType<ServerResponse['getHeaders']>; body: any }>((resolve, reject) => {
        const req = new IncomingMessage(new Socket());
        req.method = options.method ?? 'GET'; req.url = path;
        const body = options.body === undefined ? undefined : JSON.stringify(options.body);
        req.headers = { ...options.headers, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }) };
        const res = new ServerResponse(req);
        res.end = ((data?: string | Buffer) => {
            try { resolve({ status: res.statusCode, headers: res.getHeaders(), body: data ? JSON.parse(String(data)) : null }); }
            catch (error) { reject(error); }
            return res;
        }) as typeof res.end;
        app(req, res);
        req.push(body ?? null);
        if (body !== undefined) req.push(null);
    });
}
