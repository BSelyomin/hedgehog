'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionResponse } from '../../shared/types';
import { api, setSessionKey } from './common';

interface AccountContext {
    session: SessionResponse | null;
    checking: boolean;
    error: string;
    notice: string;
    accept: (session: SessionResponse, notice?: string) => void;
    refresh: () => Promise<void>;
}
const Context = createContext<AccountContext | null>(null);
export function useAccount() {
    const account = useContext(Context);
    if (!account) throw new Error('AccountProvider required');
    return account;
}
export function AccountProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<SessionResponse | null>(null);
    const [checking, setChecking] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const current = useRef<SessionResponse | null>(null);
    const generation = useRef(0);
    const channel = useRef<BroadcastChannel | null>(null);
    const accept = useCallback((next: SessionResponse, message = '') => {
        generation.current++;
        current.current = next;
        setSessionKey(next.sessionKey);
        setSession(next); setChecking(false); setError(''); setNotice(message);
        channel.current?.postMessage('changed');
    }, []);
    const refresh = useCallback(async () => {
        const request = ++generation.current;
        // Keep unfinished form edits on a normal focus check. A changed session
        // remounts the screens by sessionKey; initial loading still blocks them.
        if (!current.current) setChecking(true);
        setError('');
        try {
            const next = await api<SessionResponse>('/auth/session');
            if (request !== generation.current) return;
            if (current.current && current.current.sessionKey !== next.sessionKey)
                setNotice(next.user ? 'Your account session changed. Showing the current account’s portfolio.' : 'You are now browsing as a guest. Sign in to open your saved portfolio.');
            current.current = next;
            setSessionKey(next.sessionKey);
            setSession(next);
        } catch (e) {
            if (request === generation.current) setError((e as Error).message);
        } finally { if (request === generation.current) setChecking(false); }
    }, []);
    useEffect(() => {
        void refresh();
        const reload = () => { void refresh(); };
        const visible = () => { if (document.visibilityState === 'visible') reload(); };
        if ('BroadcastChannel' in window) {
            channel.current = new BroadcastChannel('hedgehog-account');
            channel.current.onmessage = reload;
        }
        window.addEventListener('focus', reload);
        window.addEventListener('hedgehog-session-changed', reload);
        document.addEventListener('visibilitychange', visible);
        return () => {
            generation.current++;
            channel.current?.close();
            window.removeEventListener('focus', reload);
            window.removeEventListener('hedgehog-session-changed', reload);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [refresh]);
    return <Context.Provider value={{ session, checking, error, notice, accept, refresh }}>{children}</Context.Provider>;
}
