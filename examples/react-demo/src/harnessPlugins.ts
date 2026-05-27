/// <reference types="vite/client" />
/**
 * Demo overlay plugins for the react-demo.
 *
 * Shows both flows of the overlay plugin API:
 *   1. a plain action (no element needed) that copies a share summary
 *   2. a `requiresElement` action that picks an element, screenshots it, and
 *      reports what it gathered
 *
 * Self-contained — no external endpoint required, so you can see the effect
 * by just running `pnpm dev` and clicking the "H" overlay. For a real
 * integration (Jira / Slack / webhook) see docs/overlay-plugins.md.
 */
import { registerOverlayPlugin } from '@harness-fe/runtime';

if (import.meta.env.DEV) {
    // 1. No-element action: copy a shareable scene summary to the clipboard.
    registerOverlayPlugin({
        id: 'demo-share',
        label: 'Copy share summary',
        icon: '🔗',
        async onClick(ctx) {
            const logs = ctx.getLogs({ console: 10, network: 10, errors: 10 });
            const summary = [
                ctx.snapshotMarkdown(),
                ctx.dashboardUrl ? `- dashboard: ${ctx.dashboardUrl}` : '',
                '',
                `console: ${logs.console.length} · network: ${logs.network.length} · errors: ${logs.errors.length}`,
            ]
                .filter(Boolean)
                .join('\n');
            await ctx.copyToClipboard(summary);
            ctx.toast('Share summary copied');
        },
    });

    // 2. Element action: pick an element, screenshot it, log what we collected.
    registerOverlayPlugin({
        id: 'demo-inspect',
        label: 'Inspect element',
        icon: '🔍',
        requiresElement: true,
        async onClick(ctx) {
            const el = ctx.selectedElement;
            const shot = await ctx.captureScreenshot(el?.el);
            // eslint-disable-next-line no-console
            console.log('[harness demo plugin] context', {
                selector: el?.selector,
                outerHTML: el?.outerHTML,
                screenshotBytes: shot?.data ? Math.round((shot.data.length * 3) / 4) : 0,
                snapshot: ctx.snapshot(),
                logs: ctx.getLogs({ network: 5, errors: 5 }),
            });
            ctx.toast(
                `Inspected ${el?.selector.comp ?? el?.el.tagName.toLowerCase() ?? 'element'} — see console`,
            );
        },
    });
}
