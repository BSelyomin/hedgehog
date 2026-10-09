import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
// Bound expensive work rather than letting concurrent requests exhaust memory.
let active = 0;
export class PasswordBusyError extends Error {}
async function derive(password: string, salt: string): Promise<Buffer> {
    if (active >= 2) throw new PasswordBusyError('Sign-in is busy. Please try again shortly.');
    active++;
    try {
        return await new Promise<Buffer>((resolve, reject) => {
            scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
        });
    } finally { active--; }
}

export function validatePassword(value: unknown): string {
    if (typeof value !== 'string' || value.length < 15 || value.length > 128)
        throw new Error('Use a password between 15 and 128 characters.');
    return value;
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
    // Unknown accounts do the same expensive work as an incorrect password.
    const [, salt, expected] = encoded?.split('$') ?? [];
    const valid = encoded?.startsWith('scrypt$') && /^[a-f0-9]{32}$/.test(salt ?? '') && /^[a-f0-9]{128}$/.test(expected ?? '');
    const actual = await derive(password, valid ? salt : '0'.repeat(32));
    return Boolean(valid && timingSafeEqual(actual, Buffer.from(expected, 'hex')));
}
