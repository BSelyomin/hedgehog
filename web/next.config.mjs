const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
export default { async rewrites() { return [{ source: '/api/:path*', destination: `${api}/:path*` }]; } };
