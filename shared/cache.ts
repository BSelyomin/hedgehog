// Maximum lifetime of private page responses in the browser and backend.
// Holdings changes, explicit Reload and source freshness limits can expire them earlier.
// Durable AI results remain keyed by their input data rather than this lifetime.
export const PAGE_CACHE_MS = 15 * 60_000;
