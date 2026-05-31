import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useLiveBridge } from '../hooks/useLiveBridge';
import { useApi } from '../hooks/useApi';
import type { DaemonMeta } from '../lib/types';

/**
 * Sticky glass header. Logo + breadcrumb on the left, live-status pill
 * on the right. The pill flickers green for 600ms each time a
 * dashboard.update arrives so the user has a visual cue that the feed
 * is healthy.
 */
export function Header({ crumb }: { crumb?: React.ReactNode }) {
    const [flash, setFlash] = useState(false);
    useLiveBridge(() => {
        setFlash(true);
    });
    useEffect(() => {
        if (!flash) return;
        const t = setTimeout(() => setFlash(false), 600);
        return () => clearTimeout(t);
    }, [flash]);

    return (
        <header className="glass sticky top-0 z-30 border-b border-surface-border">
            <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-3">
                <Link to="/" className="flex items-center gap-2 group">
                    <Logo />
                    <span className="text-ink-primary font-medium tracking-tight">
                        Harness
                    </span>
                    <span className="text-ink-muted text-xs font-mono">dev console</span>
                </Link>
                <VersionBadge />
                <Nav />
                {crumb ? (
                    <>
                        <span className="text-ink-muted text-sm">/</span>
                        {crumb}
                    </>
                ) : null}
                <div className="flex-1" />
                <LivePill flash={flash} />
            </div>
        </header>
    );
}

function Nav() {
    const { pathname } = useLocation();
    const onAdmin = pathname.startsWith('/admin');
    const tab = (to: string, label: string, active: boolean) => (
        <Link
            to={to}
            className={[
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                active ? 'bg-surface-raised text-ink-primary' : 'text-ink-secondary hover:text-ink-primary',
            ].join(' ')}
        >
            {label}
        </Link>
    );
    return (
        <nav className="ml-2 flex items-center gap-1">
            {tab('/', 'Data', !onAdmin)}
            {tab('/admin', 'Governance', onAdmin)}
        </nav>
    );
}

function VersionBadge() {
    const { data } = useApi<DaemonMeta>('/console/api/meta');
    if (!data) return null;
    return (
        <span
            className="text-ink-muted text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-raised border border-surface-border"
            title={`harness daemon ${data.daemonVersion} · protocol ${data.protocolVersion}`}
        >
            v{data.daemonVersion}
        </span>
    );
}

function Logo() {
    return (
        <div className="relative h-6 w-6 rounded-md overflow-hidden gradient-accent transition-transform group-hover:scale-105">
            <div className="absolute inset-[2px] rounded bg-surface-base flex items-center justify-center">
                <span className="text-[10px] font-bold text-ink-primary tracking-wider">H</span>
            </div>
        </div>
    );
}

function LivePill({ flash }: { flash: boolean }) {
    return (
        <div
            className={[
                'flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono border transition-all',
                flash
                    ? 'bg-accent-emerald/10 border-accent-emerald/40 text-accent-emerald'
                    : 'bg-surface-raised border-surface-border text-ink-secondary',
            ].join(' ')}
        >
            <span className="relative inline-flex h-1.5 w-1.5">
                <span
                    className={[
                        'absolute inset-0 rounded-full',
                        flash ? 'bg-accent-emerald animate-pulse-live' : 'bg-ink-muted',
                    ].join(' ')}
                />
            </span>
            {flash ? 'live' : 'idle'}
        </div>
    );
}
