import { proxyApi } from '../../../lib/api-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Leave room for queued result estimates and the proxy's response forwarding.
export const maxDuration = 180;
export const GET = proxyApi;
export const POST = proxyApi;
export const PUT = proxyApi;
export const PATCH = proxyApi;
export const DELETE = proxyApi;
export const OPTIONS = proxyApi;
export const HEAD = proxyApi;
