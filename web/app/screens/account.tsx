'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SessionResponse, SignUpRequest, SignInRequest, ChangePasswordRequest } from '../../../shared/types';
import { api, Card } from '../common';
import { useAccount } from '../auth';

export function SignInForm({ signup, onSuccess }: { signup: boolean; onSuccess: (session: SessionResponse, notice: string) => void }) {
    const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState(''), [saveGuestHoldings, setSaveGuestHoldings] = useState(true);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function submit(e: FormEvent) {
        e.preventDefault(); setError('');
        if (signup && password !== confirm) { setError('Passwords do not match.'); return; }
        setBusy(true);
        try {
            const body: SignUpRequest | SignInRequest = signup ? { name, email, password, saveGuestHoldings } : { email, password };
            const result = await api<SessionResponse>(signup ? '/auth/signup' : '/auth/signin', { method: 'POST', body: JSON.stringify(body) });
            onSuccess(result, signup ? 'Account created. Your portfolio is ready.' : 'Signed in. Your saved portfolio is ready.');
            window.location.hash = 'holdings';
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <div className="account-layout"><div><span className="eyebrow">Your Hedgehog account</span>
        <h1>{signup ? 'Keep your portfolio with you.' : 'Welcome back.'}</h1>
        <p>{signup ? 'Save your holdings and open your portfolio on any device.' : 'Sign in to see your saved holdings and the events that matter to them.'}</p>
        <p className="note">Hedgehog never trades. Your account stores the holdings you enter or import.</p>
        <a className="account-link" href="#holdings">Continue as a guest →</a></div>
        <Card><h2>{signup ? 'Create an account' : 'Sign in'}</h2>
            <form onSubmit={submit} className="account-form">
                {signup && <label>Name<input autoComplete="name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></label>}
                <label>Email<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/></label>
                <label>Password<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={15} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-describedby={signup ? 'password-help' : undefined}/></label>
                {signup && <><p id="password-help" className="note">Use 15–128 characters. A memorable passphrase works well. Keep it somewhere safe; email password recovery is not available yet.</p>
                    <label>Confirm password<input type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy}/></label>
                    <label className="check-label"><input type="checkbox" checked={saveGuestHoldings} onChange={e => setSaveGuestHoldings(e.target.checked)} disabled={busy}/>Save my guest portfolio to this account</label>
                    <p className="note">This includes holdings already saved with “Map my exposure”. Unsaved edits are not included.</p></>}
                {!signup && <p className="note">Signing in opens your account portfolio. Guest holdings are not merged.</p>}
                {error && <p className="error" role="alert">{error}</p>}
                <button className="primary" disabled={busy} type="submit">{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
            </form>
            <p>{signup ? 'Already have an account? ' : 'New to Hedgehog? '}<a className="account-link" href={signup ? '#signin' : '#signup'}>{signup ? 'Sign in' : 'Create an account'}</a></p>
        </Card></div>;
}

export function AccountScreen({ signup = false }: { signup?: boolean }) {
    const { session, accept } = useAccount();
    const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (!session?.user) return <SignInForm key={signup ? 'signup' : 'signin'} signup={signup} onSuccess={accept}/>;
    const user = session.user;
    async function changePassword(e: FormEvent) {
        e.preventDefault(); setError('');
        if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
        setBusy(true);
        try {
            const body: ChangePasswordRequest = { currentPassword, newPassword };
            const result = await api<SessionResponse>('/auth/password', { method: 'POST', body: JSON.stringify(body) });
            setCurrentPassword(''); setNewPassword(''); setConfirm('');
            accept(result, 'Password changed. Your other sessions have been signed out.');
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    async function signout(others: boolean) {
        setBusy(true); setError('');
        try {
            const result = await api<SessionResponse>(others ? '/auth/signout-others' : '/auth/signout', { method: 'POST', body: '{}' });
            accept(result, others ? 'Other sessions signed out.' : 'Signed out. Your account portfolio is saved.');
            if (!others) window.location.hash = 'signin';
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <><span className="eyebrow">Account</span><h1>{user.name}’s account</h1>
        <div className="account-layout"><Card><h2>Your profile</h2><dl className="profile-details"><dt>Name</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd><dt>Joined</dt><dd>{new Date(user.createdAt).toLocaleDateString()}</dd></dl>
            <p>Your holdings are saved to this account and available whenever you sign in.</p>
            <a className="account-link" href="#holdings">Manage holdings →</a>
            <div className="actions"><button disabled={busy} onClick={() => void signout(false)}>Sign out</button><button disabled={busy} onClick={() => void signout(true)}>Sign out other sessions</button></div>
            <p className="note">Signing out keeps your saved portfolio. Clearing it on the holdings screen removes it from your account on every device.</p>
        </Card><Card><h2>Change password</h2><form className="account-form" onSubmit={changePassword}>
            <label>Current password<input type="password" autoComplete="current-password" required minLength={15} maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} disabled={busy}/></label>
            <label>New password<input type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={busy}/></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy}/></label>
            <p className="note">Use 15–128 characters. Changing your password signs out your other sessions.</p>
            <button className="primary" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Update password'}</button>
        </form></Card></div>{error && <p className="error" role="alert">{error}</p>}</>;
}
