import { useCallback, useEffect, useState } from 'react';
import { adminLogin, apiPost } from '../lib/api';

interface ServerRec { id: string; name: string; env: string; endpoint: string }
interface TokenRec { id: string; name: string; serverId: string; scopes: string[]; revokedAt?: number; expiresAt?: number }
interface AuditRec { ts: number; tool: string; tokenId?: string; ip?: string }

async function getJson<T>(path: string): Promise<T> {
    const r = await fetch(path, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
}

export function Governance() {
    const [authed, setAuthed] = useState<boolean | null>(null);
    const [servers, setServers] = useState<ServerRec[]>([]);
    const [tokens, setTokens] = useState<TokenRec[]>([]);
    const [audit, setAudit] = useState<AuditRec[]>([]);
    const [newToken, setNewToken] = useState<string | undefined>();
    const [err, setErr] = useState<string | undefined>();

    const refresh = useCallback(async () => {
        try {
            const [s, t, a] = await Promise.all([
                getJson<ServerRec[]>('/admin/api/servers'),
                getJson<TokenRec[]>('/admin/api/tokens'),
                getJson<AuditRec[]>('/admin/api/audit'),
            ]);
            setServers(s);
            setTokens(t);
            setAudit(a);
            setAuthed(true);
        } catch {
            setAuthed(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    if (authed === null) return <p className="text-sm text-ink-muted">…</p>;
    if (!authed) return <Login onDone={refresh} />;

    const sName = (id?: string) => servers.find((s) => s.id === id)?.name ?? id ?? '';

    const createToken = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErr(undefined);
        const fd = new FormData(e.currentTarget);
        const scopes = ['read', 'control', 'write'].filter((s) => fd.get(s));
        try {
            const r = await apiPost<{ raw: string }>('/admin/api/tokens', {
                name: fd.get('name'),
                serverId: fd.get('serverId'),
                scopes,
            });
            setNewToken(r.raw);
            (e.target as HTMLFormElement).reset();
            await refresh();
        } catch (x) {
            setErr(x instanceof Error ? x.message : String(x));
        }
    };

    const revoke = async (id: string) => {
        await apiPost('/admin/api/tokens/revoke', { id });
        await refresh();
    };

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold">Governance</h1>
                <form method="post" action="/admin/logout"><button className="rounded-md border border-surface-border px-2.5 py-1 text-xs text-ink-secondary">Sign out</button></form>
            </div>
            {err && <p className="text-sm text-accent-rose">{err}</p>}

            <section>
                <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Tokens</h2>
                <form onSubmit={createToken} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <input name="name" placeholder="name" required className="rounded border border-surface-border bg-surface-sunken px-2 py-1" />
                    <select name="serverId" className="rounded border border-surface-border bg-surface-sunken px-2 py-1">
                        {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <label className="flex items-center gap-1"><input type="checkbox" name="read" defaultChecked />read</label>
                    <label className="flex items-center gap-1"><input type="checkbox" name="control" />control</label>
                    <label className="flex items-center gap-1"><input type="checkbox" name="write" />write</label>
                    <button className="rounded bg-accent-indigo/20 px-2.5 py-1 text-accent-indigo">Create</button>
                </form>
                {newToken && (
                    <p className="mb-2 break-all rounded bg-surface-sunken p-2 text-xs">
                        New token (copy now, shown once): <code className="text-accent-emerald">{newToken}</code>
                    </p>
                )}
                <Table head={['name', 'server', 'scopes', 'state', '']}>
                    {tokens.map((t) => (
                        <tr key={t.id} className="border-t border-surface-border">
                            <td className="px-2 py-1">{t.name}</td>
                            <td className="px-2 py-1">{sName(t.serverId)}</td>
                            <td className="px-2 py-1 font-mono text-xs">{t.scopes.join('+')}</td>
                            <td className="px-2 py-1">{t.revokedAt ? 'revoked' : t.expiresAt && Date.now() > t.expiresAt ? 'expired' : 'active'}</td>
                            <td className="px-2 py-1">{!t.revokedAt && <button onClick={() => revoke(t.id)} className="text-accent-rose">revoke</button>}</td>
                        </tr>
                    ))}
                </Table>
            </section>

            <section>
                <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Servers</h2>
                <Table head={['name', 'env', 'endpoint']}>
                    {servers.map((s) => (
                        <tr key={s.id} className="border-t border-surface-border">
                            <td className="px-2 py-1">{s.name}</td>
                            <td className="px-2 py-1">{s.env}</td>
                            <td className="px-2 py-1 font-mono text-xs">{s.endpoint}</td>
                        </tr>
                    ))}
                </Table>
            </section>

            <section>
                <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Audit (latest)</h2>
                <Table head={['time', 'tool', 'token', 'ip']}>
                    {audit.slice().reverse().map((a, i) => (
                        <tr key={i} className="border-t border-surface-border">
                            <td className="px-2 py-1">{new Date(a.ts).toLocaleTimeString()}</td>
                            <td className="px-2 py-1 font-mono text-xs">{a.tool}</td>
                            <td className="px-2 py-1 font-mono text-xs">{a.tokenId ?? ''}</td>
                            <td className="px-2 py-1">{a.ip ?? ''}</td>
                        </tr>
                    ))}
                </Table>
            </section>
        </div>
    );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
    return (
        <table className="w-full rounded-lg border border-surface-border bg-surface-raised text-sm">
            <thead>
                <tr className="text-left text-xs text-ink-muted">
                    {head.map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    );
}

function Login({ onDone }: { onDone: () => void }) {
    const [err, setErr] = useState<string | undefined>();
    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErr(undefined);
        const fd = new FormData(e.currentTarget);
        try {
            await adminLogin(String(fd.get('username') ?? ''), String(fd.get('password') ?? ''));
            onDone();
        } catch {
            setErr('Invalid credentials.');
        }
    };
    return (
        <form onSubmit={submit} className="mx-auto mt-16 max-w-xs space-y-3 rounded-lg border border-surface-border bg-surface-raised p-4">
            <h1 className="text-sm font-semibold">Gateway sign in</h1>
            {err && <p className="text-sm text-accent-rose">{err}</p>}
            <input name="username" placeholder="username" required className="w-full rounded border border-surface-border bg-surface-sunken px-2 py-1.5 text-sm" />
            <input name="password" type="password" placeholder="password" required className="w-full rounded border border-surface-border bg-surface-sunken px-2 py-1.5 text-sm" />
            <button className="w-full rounded bg-accent-indigo/20 px-2.5 py-1.5 text-sm text-accent-indigo">Sign in</button>
        </form>
    );
}
