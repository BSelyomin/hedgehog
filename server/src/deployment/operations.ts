import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiErrorResponse, OperationalResponse } from '../../../shared/types.ts';
import { schedules, scheduleDue } from '../jobs/schedules.ts';

export interface OperationsDependencies {
    jobs: readonly string[];
    run: (name: string) => Promise<void>;
    resume: (name: string) => Promise<void>;
    migrate: () => Promise<void>;
    status: () => Promise<{ pendingMigrations: string[]; readOnly: boolean }>;
    background: (task: Promise<unknown>) => void;
}
interface Input { method: string; path: string; authorization?: string; secret?: string; force?: boolean; at?: Date }
interface Result { status: number; body: ApiErrorResponse | OperationalResponse; allow?: string }
const hash = (value: string) => createHash('sha256').update(value).digest();

/** Authenticate before dispatch, including local requests. No cookies authorize maintenance. */
export async function operationalRequest(input: Input, deps: OperationsDependencies): Promise<Result> {
    const error = (status: number, error: string, allow?: string): Result => ({ status, body: { error, asOf: null }, allow });
    if (!input.secret || input.secret.length < 16) return error(503, 'Configure CRON_SECRET with at least 16 characters.');
    if (!timingSafeEqual(hash(input.authorization ?? ''), hash(`Bearer ${input.secret}`))) return error(401, 'Unauthorized');
    const at = input.at ?? new Date();
    const answer = (status: OperationalResponse['status'], fields: Partial<OperationalResponse> = {}): Result =>
        ({ status: status === 'accepted' ? 202 : 200, body: { ...fields, status, asOf: at.toISOString() } });
    const retain = (job: string, task: Promise<unknown>) => {
        console.info('[Vercel maintenance] accepted', { job });
        deps.background(task.then(() => { console.info('[Vercel maintenance] invocation_finished', { job }); }).catch(() => {
            // Never log credentials, provider payloads, or database connection errors.
            console.warn('[Vercel maintenance] invocation_failed', { job });
        }));
    };
    if (input.path === '/status') {
        if (input.method !== 'GET') return error(405, 'Method not allowed', 'GET');
        const state = await deps.status();
        return answer(state.pendingMigrations.length ? 'pending' : 'ready', state);
    }
    if (input.path === '/migrate') {
        if (input.method !== 'POST') return error(405, 'Method not allowed', 'POST');
        retain('migrate', deps.migrate());
        return answer('accepted', { job: 'migrate' });
    }
    const match = /^\/(jobs|resume)\/([a-z][a-z0-9-]*)$/.exec(input.path);
    if (!match) return error(404, 'Operational endpoint not found');
    const [, action, id] = match;
    const allowedMethod = action === 'resume' ? 'POST' : 'GET';
    if (input.method !== allowedMethod) return error(405, 'Method not allowed', allowedMethod);
    const schedule = schedules.find(s => s.id === id);
    const name = schedule?.job ?? id;
    if (!deps.jobs.includes(name)) return error(404, 'Scheduled job not found');
    if (action === 'resume') {
        await deps.resume(name);
        return answer('resumed', { job: name });
    }
    if (schedule && !input.force && !scheduleDue(schedule, at)) {
        console.info('[Vercel maintenance] skipped_outside_eastern_hour', { job: name });
        return answer('skipped', { job: name });
    }
    retain(name, deps.run(name));
    return answer('accepted', { job: name });
}
