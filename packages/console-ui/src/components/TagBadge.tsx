/**
 * Timeline event tag. Color-coded per event type to match the legacy
 * dashboard's color scheme so users with muscle memory feel at home.
 */
const STYLES: Record<string, string> = {
    log: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    err: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    net: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
    cmd: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    resp: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    applog: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    rrweb: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
    load: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    pageinfo: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
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
