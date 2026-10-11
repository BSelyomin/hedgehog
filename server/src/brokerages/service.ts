import type { PoolClient } from 'pg';
import type { BrokerageAccount, BrokeragesResponse, BrokerageActivitiesResponse } from '../../../shared/types.ts';
import { pool, query, iso } from '../db.ts';
import { runWithoutRetry } from '../services/no-retry.ts';
import { BrokerageError, configuration, mode, encryptSecret, decryptSecret, snaptrade } from './client.ts';
import type { Credentials } from './client.ts';
import { object, uuid, parsePositions, positionsToHoldings } from './positions.ts';
import { convertSnapTradeActivities } from './activities.ts';

interface ProviderUser { provider_user_id: string; encrypted_secret: string; client_hash: string }
const owner = (userId: string) => `${userId}:${mode()}`;
async function locked<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect(), lockKey = `snaptrade:${owner(userId)}`;
    let acquired = false;
    try {
        acquired = Boolean((await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [lockKey])).rows[0]?.locked);
        if (!acquired) throw new BrokerageError('A brokerage update is already running. Try again shortly.', 409);
        return await work(client);
    } finally {
        if (acquired) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
        client.release();
    }
}
async function credentials(client: PoolClient, userId: string, register: boolean): Promise<Credentials | null> {
    const config = configuration();
    if (!config.configured) throw new BrokerageError('SnapTrade is not configured. Manual entry and CSV uploads are still available.');
    let row = (await client.query<ProviderUser>('SELECT * FROM snaptrade_users WHERE user_id=$1 AND mode=$2', [userId, mode()])).rows[0];
    if (!row && register) {
        // Stable immutable IDs per app user and environment. Never use an email address.
        const providerId = `hedgehog-${mode()}-${userId}`;
        const result = object(await snaptrade('POST', '/snapTrade/registerUser', undefined, { userId: providerId }));
        if (result.userId !== providerId || typeof result.userSecret !== 'string' || !result.userSecret)
            throw new BrokerageError('SnapTrade registration returned unexpected credentials.');
        row = { provider_user_id: providerId, encrypted_secret: encryptSecret(result.userSecret, owner(userId)), client_hash: config.clientHash };
        await client.query('INSERT INTO snaptrade_users(user_id,mode,client_hash,provider_user_id,encrypted_secret) VALUES($1,$2,$3,$4,$5)',
            [userId, mode(), row.client_hash, row.provider_user_id, row.encrypted_secret]);
    }
    if (!row) return null;
    if (row.client_hash !== config.clientHash) throw new BrokerageError('These brokerage connections belong to a different SnapTrade client. Restore its API keys.');
    return { userId: row.provider_user_id, userSecret: decryptSecret(row.encrypted_secret, owner(userId)) };
}
export async function brokerageStatus(userId: string): Promise<BrokeragesResponse> {
    const config = configuration();
    const users = await query<{ checked_at: Date | null; client_hash: string }>('SELECT checked_at,client_hash FROM snaptrade_users WHERE user_id=$1 AND mode=$2', [userId, mode()]);
    const matchingClient = !users[0] || users[0].client_hash === config.clientHash;
    const connections = await query<{ id: string; name: string; disabled: boolean }>('SELECT id,name,disabled FROM brokerage_connections WHERE user_id=$1 AND mode=$2 AND NOT disconnected ORDER BY name', [userId, mode()]);
    const rows = await query<{ id: string; connection_id: string; name: string; institution: string; number_mask: string; included: boolean; available: boolean; positions: BrokerageAccount['positions']; as_of: Date | null; sync_error: string | null }>(
        `SELECT a.* FROM brokerage_accounts a JOIN brokerage_connections c ON c.user_id=a.user_id AND c.mode=a.mode AND c.id=a.connection_id
         WHERE a.user_id=$1 AND a.mode=$2 AND NOT c.disconnected ORDER BY a.institution,a.name,a.id`, [userId, mode()]);
    const accounts = rows.map(r => ({ id: r.id, connectionId: r.connection_id, name: r.name, institution: r.institution, numberMask: r.number_mask,
        included: r.included, available: r.available && config.configured && matchingClient, positions: r.positions, asOf: iso(r.as_of), syncError: r.sync_error }));
    return { configured: config.configured && matchingClient, mode: mode(), connections, accounts, checkedAt: iso(users[0]?.checked_at),
        asOf: accounts.reduce<string | null>((date, a) => a.asOf && (!date || a.asOf < date) ? a.asOf : date, null),
        message: !config.configured ? 'Configure server-side SnapTrade commercial API keys, encryption key and APP_URL to enable linking. Manual entry and CSV remain available.' :
            !matchingClient ? 'Restore the SnapTrade API keys used to create these connections.' : mode() === 'sandbox' ? 'Simulated brokerage data. Sandbox requires commercial test keys; production keys do not support it.' : 'Read-only brokerage data. Availability depends on your SnapTrade brokerage coverage.' };
}
export async function connect(userId: string, reconnect?: string) {
    return locked(userId, async client => {
        if (reconnect) {
            const id = uuid(reconnect);
            const rows = await client.query('SELECT id FROM brokerage_connections WHERE user_id=$1 AND mode=$2 AND id=$3 AND NOT disconnected', [userId, mode(), id]);
            if (!rows.rowCount) throw new BrokerageError('Brokerage connection not found', 404);
        }
        const auth = (await credentials(client, userId, true))!;
        const result = object(await snaptrade('POST', '/snapTrade/login', auth, {
            connectionType: 'read', darkMode: true, immediateRedirect: true,
            customRedirect: `${configuration().appUrl.replace(/\/$/, '')}/#brokerages`,
            ...(mode() === 'sandbox' ? { broker: 'SANDBOX' } : {}), ...(reconnect ? { reconnect } : {}),
        }));
        let portal: URL;
        try { portal = new URL(String(result.redirectURI)); } catch { throw new BrokerageError('SnapTrade returned an invalid portal URL.'); }
        if (portal.protocol !== 'https:' || !['app.snaptrade.com', 'connect.snaptrade.com'].includes(portal.hostname) || portal.username || portal.password)
            throw new BrokerageError('SnapTrade returned an untrusted portal URL.');
        return { portalUrl: portal.toString(), asOf: new Date().toISOString() };
    });
}
export async function sync(userId: string, automatic = false): Promise<BrokeragesResponse> {
    await locked(userId, async client => {
        const auth = await credentials(client, userId, false);
        if (!auth) return;
        const rawConnections = await snaptrade('GET', '/authorizations', auth);
        // Documented legacy investment-account endpoint; see SNAPTRADE.md for migration note.
        const rawAccounts = await snaptrade('GET', '/accounts', auth);
        if (!Array.isArray(rawConnections) || !Array.isArray(rawAccounts)) throw new BrokerageError('SnapTrade returned unexpected accounts. Previous holdings were preserved.');
        const connections = rawConnections.map(value => {
            const row = object(value), broker = object(row.brokerage);
            if (typeof row.disabled !== 'boolean') throw new BrokerageError('SnapTrade returned an unexpected connection state.');
            const sandbox = String(broker.slug).toUpperCase() === 'SANDBOX';
            return { id: uuid(row.id), brokerId: String(broker.id ?? broker.slug), name: String(broker.display_name ?? broker.name ?? 'Brokerage'),
                disabled: row.disabled || row.type !== 'read' || sandbox !== (mode() === 'sandbox') };
        });
        const tombstones = (await client.query<{ id: string }>('SELECT id FROM brokerage_connections WHERE user_id=$1 AND mode=$2 AND disconnected', [userId, mode()])).rows.map(r => r.id);
        const accounts = [];
        for (const value of rawAccounts) {
            const row = object(value), id = uuid(row.id), connectionId = uuid(row.brokerage_authorization);
            const connection = connections.find(c => c.id === connectionId);
            if (!connection || tombstones.includes(connectionId)) continue;
            const syncStatus = row.sync_status ? object(row.sync_status) : {};
            const holdings = syncStatus.holdings ? object(syncStatus.holdings) : {};
            const ready = !connection.disabled && holdings.initial_sync_completed === true && holdings.holdings_unavailable !== true &&
                !['closed', 'archived'].includes(String(row.status).toLowerCase()) && (!row.account_category || row.account_category === 'INVESTMENT');
            let snapshot: ReturnType<typeof parsePositions> | null = null;
            let error: string | null = ready ? null : 'Connection disabled, holdings unavailable, or initial sync pending. Excluded from exposure.';
            if (ready) {
                try {
                    const load = async () => parsePositions(await snaptrade('GET', `/accounts/${id}/positions/all`, auth));
                    snapshot = automatic ? await runWithoutRetry(`brokerages:positions:${userId}:${id}`, load) ?? null : await load();
                    if (snapshot) positionsToHoldings(snapshot.positions);
                    if (!snapshot?.asOf) error = 'Source timestamp unavailable or automatic sync stopped. Excluded from exposure.';
                } catch { error = 'Positions could not be synced. Previous data retained and excluded until sync succeeds.'; }
            }
            const digits = typeof row.number === 'string' ? row.number.replace(/\s/g, '').slice(-4) : '';
            accounts.push({ id, connectionId, name: typeof row.name === 'string' && row.name ? row.name : 'Investment account', institution: connection.name,
                identity: typeof row.institution_account_id === 'string' && row.institution_account_id ? `${connection.brokerId}:${row.institution_account_id}` : null,
                numberMask: digits ? `••••${digits}` : 'Unavailable', snapshot, available: ready && !!snapshot?.asOf && !error, error });
        }
        // The stable institution identifier is used only in memory, never returned or stored.
        for (const a of accounts) {
            if (a.identity && accounts.some(other => other.id !== a.id && other.identity === a.identity)) {
                a.available = false;
                a.error = 'Duplicate brokerage account across connections. Disconnect the duplicate connection and sync again.';
            }
        }
        await client.query('BEGIN');
        try {
            await client.query('UPDATE brokerage_connections SET disabled=true WHERE user_id=$1 AND mode=$2', [userId, mode()]);
            await client.query('UPDATE brokerage_accounts SET available=false,sync_error=$3 WHERE user_id=$1 AND mode=$2', [userId, mode(), 'Account no longer returned by SnapTrade. Excluded from exposure.']);
            for (const c of connections) {
                await client.query(`INSERT INTO brokerage_connections(user_id,mode,id,name,disabled) VALUES($1,$2,$3,$4,$5)
                    ON CONFLICT(user_id,mode,id) DO UPDATE SET name=excluded.name,disabled=excluded.disabled`, [userId, mode(), c.id, c.name, c.disabled]);
            }
            for (const a of accounts) {
                await client.query(`INSERT INTO brokerage_accounts(user_id,mode,id,connection_id,name,institution,number_mask,available,positions,as_of,sync_error)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
                    ON CONFLICT(user_id,mode,id) DO UPDATE SET connection_id=excluded.connection_id,name=excluded.name,institution=excluded.institution,
                    number_mask=excluded.number_mask,available=excluded.available,
                    positions=CASE WHEN $12 THEN excluded.positions ELSE brokerage_accounts.positions END,
                    as_of=CASE WHEN $12 THEN excluded.as_of ELSE brokerage_accounts.as_of END,sync_error=excluded.sync_error`,
                    [userId, mode(), a.id, a.connectionId, a.name, a.institution, a.numberMask, a.available, JSON.stringify(a.snapshot?.positions ?? []), a.snapshot?.asOf ?? null, a.error, !!a.snapshot?.asOf]);
            }
            await client.query('UPDATE snaptrade_users SET checked_at=now() WHERE user_id=$1 AND mode=$2', [userId, mode()]);
            await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    return brokerageStatus(userId);
}
export async function selectAccount(userId: string, accountId: string, included: boolean) {
    await locked(userId, async client => {
        const result = await client.query(`UPDATE brokerage_accounts a SET included=$4 FROM brokerage_connections c
            WHERE a.user_id=$1 AND a.mode=$2 AND a.id=$3 AND c.user_id=a.user_id AND c.mode=a.mode AND c.id=a.connection_id AND NOT c.disconnected`,
            [userId, mode(), uuid(accountId), included]);
        if (!result.rowCount) throw new BrokerageError('Brokerage account not found', 404);
    });
    return brokerageStatus(userId);
}
export async function accountActivities(userId: string, accountId: string, offset: number, limit: number): Promise<BrokerageActivitiesResponse> {
    return locked(userId, async client => {
        const id = uuid(accountId);
        const owned = await client.query(`SELECT a.id FROM brokerage_accounts a JOIN brokerage_connections c
            ON c.user_id=a.user_id AND c.mode=a.mode AND c.id=a.connection_id
            WHERE a.user_id=$1 AND a.mode=$2 AND a.id=$3 AND NOT c.disconnected`, [userId, mode(), id]);
        if (!owned.rowCount) throw new BrokerageError('Brokerage account not found', 404);
        const auth = (await credentials(client, userId, false))!;
        const converted = convertSnapTradeActivities(await snaptrade('GET', `/accounts/${id}/activities`, auth, undefined, { offset, limit }));
        if (converted.pagination.offset !== offset || converted.pagination.limit !== limit)
            throw new BrokerageError('SnapTrade returned a different activity page than requested.');
        return { accountId: id, source: 'SnapTrade', mode: mode(), fetchedAt: new Date().toISOString(), asOf: null, ...converted };
    });
}
export async function disconnect(userId: string, connectionId: string) {
    await locked(userId, async client => {
        const id = uuid(connectionId);
        const rows = await client.query('SELECT id FROM brokerage_connections WHERE user_id=$1 AND mode=$2 AND id=$3 AND NOT disconnected', [userId, mode(), id]);
        if (!rows.rowCount) throw new BrokerageError('Brokerage connection not found', 404);
        const auth = (await credentials(client, userId, false))!;
        // SnapTrade deletion is asynchronous. Tombstone first to prevent a later sync resurrecting it.
        await client.query('BEGIN');
        try {
            await client.query('UPDATE brokerage_connections SET disconnected=true WHERE user_id=$1 AND mode=$2 AND id=$3', [userId, mode(), id]);
            await client.query('DELETE FROM brokerage_accounts WHERE user_id=$1 AND mode=$2 AND connection_id=$3', [userId, mode(), id]);
            await snaptrade('DELETE', `/connection/${id}`, auth);
            await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    return brokerageStatus(userId);
}
export async function syncBrokerages() {
    if (!configuration().configured) return;
    const users = await query<{ user_id: string }>('SELECT user_id FROM snaptrade_users WHERE mode=$1 AND client_hash=$2', [mode(), configuration().clientHash]);
    for (const user of users) {
        try { await runWithoutRetry(`brokerages:${user.user_id}`, () => sync(user.user_id, true)); }
        catch { console.warn('Brokerage sync unavailable for one user; previous snapshot retained'); }
    }
}
