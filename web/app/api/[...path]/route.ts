import { proxyApi } from '../../../lib/api-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Leave room for the proxy's 85-second write timeout and response forwarding.
export const maxDuration = 120;
export const GET = proxyApi;
export const POST = proxyApi;
export const PUT = proxyApi;
export const PATCH = proxyApi;
export const DELETE = proxyApi;
export const OPTIONS = proxyApi;
export const HEAD = proxyApi;
