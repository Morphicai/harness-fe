/**
 * Verify the Vite plugin's HTML transform without spinning up an HTTP server.
 * Calls the plugin's `transformIndexHtml.handler` directly.
 */
import { harnessaFE } from '@harnessa-fe/vite';

const plugin = harnessaFE({ projectId: 'react-demo-test' });
const html = `<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>`;
const transform = plugin.transformIndexHtml;
if (!transform || typeof transform !== 'object' || typeof transform.handler !== 'function') {
    throw new Error('plugin.transformIndexHtml.handler not found');
}
// Call the handler. Vite passes (html, ctx) but our handler ignores ctx.
const out = await transform.handler(html, {
    path: '/',
    filename: 'index.html',
    server: undefined,
    bundle: undefined,
    chunk: undefined,
});
const transformed = typeof out === 'string' ? out : html;
console.log('--- transformed HTML ---');
console.log(transformed);
console.log('------------------------');

const expectations = [
    '__HARNESSA_FE__',
    '"projectId":"react-demo-test"',
    "import '@harnessa-fe/runtime'",
];
for (const e of expectations) {
    if (!transformed.includes(e)) {
        console.error(`FAIL: missing "${e}" in transformed HTML`);
        process.exit(1);
    }
}
console.log('inject.e2e ALL PASS ✓');
