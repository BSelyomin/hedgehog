// API forwarding lives in app/api/[...path]/route.ts so upstream failures always return JSON.
export default {
    // Integration tests import backend helpers. Check them with the monorepo's
    // lint/test commands; a web-only deployment checks web application code.
    typescript: { tsconfigPath: 'tsconfig.build.json' },
};
