/**
 * Timeline event tag. Color-coded per event type to match the legacy
 * dashboard's color scheme so users with muscle memory feel at home.
 */
const STYLES: Record<string, string> = {
    console: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    error: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    network: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
    storage: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
    ws: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20',
    navigation: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    globals: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    indexeddb: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    load: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    rrweb: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
    'rrweb:marker': 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
    cmd: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    resp: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    'app-log': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    hmr: 'bg-lime-500/10 text-lime-300 border-lime-500/20',
    'node:log': 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    'node:err': 'bg-rose-500/10 text-rose-300 border-rose-500/20',
};

const DEFAULT = 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20';

export function TagBadge({ tag }: { tag: string }) {
    const cls = STYLES[tag] ?? DEFAULT;
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide border ${cls}`}
        >
            {tag}
        </span>
    );
}
