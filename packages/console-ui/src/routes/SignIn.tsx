import { useState } from 'react';
import { adminLogin } from '../lib/api';
import { setToken } from '../lib/token';

/**
 * The console sign-in — shown under the Governed policy until the viewer is
 * authenticated. Two ways in:
 *   - **Admin** (username / password → session cookie) → sees everything.
 *   - **Agent read token** (pasted, kept in sessionStorage, sent as Bearer) →
 *     scoped to exactly the projects the token is bound to.
 *
 * `onDone` re-checks `whoami` so the shell swaps to the data view in place.
 */
export function SignIn({ onDone }: { onDone: () => void }) {
    return (
        <div className="min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-sm space-y-6 animate-fade-in">
                <div className="text-center">
                    <div className="mx-auto h-10 w-10 rounded-lg gradient-accent" />
                    <h1 className="mt-3 text-lg font-semibold tracking-tight">Harness console</h1>
                    <p className="mt-1 text-sm text-ink-secondary">Sign in to view sessions.</p>
                </div>
                <TokenForm onDone={onDone} />
                <div className="flex items-center gap-3 text-xs text-ink-muted">
                    <div className="h-px flex-1 bg-surface-border" />
                    or
                    <div className="h-px flex-1 bg-surface-border" />
                </div>
                <AdminForm onDone={onDone} />
            </div>
        </div>
    );
}

function TokenForm({ onDone }: { onDone: () => void }) {
    const [token, setTok] = useState('');
    const [err, setErr] = useState<string | undefined>();
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const t = token.trim();
        if (!t) {
            setErr('Paste a read-scope agent token.');
            return;
        }
        setToken(t);
        onDone();
    };
    return (
        <form onSubmit={submit} className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-4">
            <label className="text-xs font-medium text-ink-secondary">Agent read token</label>
            <input
                value={token}
                onChange={(e) => setTok(e.target.value)}
                placeholder="hfe_…"
                className="w-full rounded-md border border-surface-border bg-surface-sunken px-3 py-2 font-mono text-sm text-ink-primary outline-none focus:border-accent-indigo"
                autoFocus
            />
            {err ? <p className="text-xs text-accent-rose">{err}</p> : null}
            <button className="w-full rounded-md bg-accent-indigo/20 px-3 py-2 text-sm text-accent-indigo hover:bg-accent-indigo/30">
                View with token
            </button>
            <p className="text-[11px] text-ink-muted">
                Scoped to the token's projects. Issued by an admin (gateway <code className="font-mono">--issue-token scopes=read</code>).
            </p>
        </form>
    );
}

function AdminForm({ onDone }: { onDone: () => void }) {
    const [err, setErr] = useState<string | undefined>();
    const [busy, setBusy] = useState(false);
    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErr(undefined);
        setBusy(true);
        const fd = new FormData(e.currentTarget);
        try {
            await adminLogin(String(fd.get('username') ?? ''), String(fd.get('password') ?? ''));
            onDone();
        } catch {
            setErr('Invalid credentials.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={submit} className="space-y-2 rounded-xl border border-surface-border bg-surface-raised p-4">
            <label className="text-xs font-medium text-ink-secondary">Admin sign-in (sees all)</label>
            <input name="username" placeholder="username" autoComplete="username" className="w-full rounded-md border border-surface-border bg-surface-sunken px-3 py-2 text-sm outline-none focus:border-accent-indigo" />
            <input name="password" type="password" placeholder="password" autoComplete="current-password" className="w-full rounded-md border border-surface-border bg-surface-sunken px-3 py-2 text-sm outline-none focus:border-accent-indigo" />
            {err ? <p className="text-xs text-accent-rose">{err}</p> : null}
            <button disabled={busy} className="w-full rounded-md border border-surface-border px-3 py-2 text-sm text-ink-secondary hover:text-ink-primary disabled:opacity-50">
                {busy ? 'Signing in…' : 'Sign in as admin'}
            </button>
        </form>
    );
}
