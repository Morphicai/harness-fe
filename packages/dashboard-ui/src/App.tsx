/**
 * SPA shell — scaffold for PR A.
 *
 * The real routing (ProjectList + SessionDetail) lands in PR C. This page
 * just confirms the build pipeline works end-to-end and the design tokens
 * resolve correctly.
 */
export function App() {
    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 px-6 py-12 max-w-5xl mx-auto w-full">
                <HelloHero />
            </main>
            <Footer />
        </div>
    );
}

function Header() {
    return (
        <header className="glass sticky top-0 z-30 border-b border-surface-border">
            <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3">
                <Logo />
                <span className="text-ink-primary font-medium tracking-tight">
                    Harnessa
                </span>
                <span className="text-ink-muted text-xs font-mono">dev console</span>
                <div className="flex-1" />
                <LiveIndicator />
            </div>
        </header>
    );
}

function Logo() {
    return (
        <div className="relative h-6 w-6 rounded-md overflow-hidden gradient-accent">
            <div className="absolute inset-[2px] rounded bg-surface-base flex items-center justify-center">
                <span className="text-[10px] font-bold text-ink-primary tracking-wider">H</span>
            </div>
        </div>
    );
}

function LiveIndicator() {
    return (
        <div className="flex items-center gap-2 text-xs text-ink-secondary">
            <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-accent-emerald animate-pulse-live" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-emerald" />
            </span>
            scaffold
        </div>
    );
}

function HelloHero() {
    return (
        <section className="animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-raised border border-surface-border text-xs text-ink-secondary font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-indigo" />
                @harnessa-fe/dashboard-ui · v0.1.0
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight">
                Dashboard scaffold up.
            </h1>
            <p className="mt-4 text-ink-secondary max-w-xl leading-relaxed">
                This is the SPA shell that the mcp-server will serve at{' '}
                <code className="font-mono text-ink-primary px-1.5 py-0.5 rounded bg-surface-raised border border-surface-border">
                    /dashboard/
                </code>
                . Project list and live session detail land in the next pull
                request — for now you're looking at the design tokens, the
                build pipeline, and the asset prefix doing their job.
            </p>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card title="Live updates" body="WebSocket subscriber pushes session.update frames as host apps stream events." />
                <Card title="JSON API" body="REST surface under /api/* for the SPA — same data the legacy HTML rendered." />
                <Card title="MCP tool" body="dashboard.open returns this URL so agents can surface it to the human." />
            </div>
        </section>
    );
}

function Card({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-lg border border-surface-border bg-surface-raised p-4 shadow-soft transition-colors hover:border-surface-border-strong">
            <div className="text-sm font-medium text-ink-primary">{title}</div>
            <div className="mt-1.5 text-xs text-ink-secondary leading-relaxed">{body}</div>
        </div>
    );
}

function Footer() {
    return (
        <footer className="border-t border-surface-border">
            <div className="max-w-5xl mx-auto px-6 h-12 flex items-center gap-4 text-xs text-ink-muted">
                <span>harnessa-fe</span>
                <span>·</span>
                <span className="font-mono">react · vite · tailwind</span>
            </div>
        </footer>
    );
}
