/**
 * Intercepts `process.stdout.write` and `process.stderr.write` to emit
 * `'node:log'` / `'node:err'` events to the MCP server.
 *
 * Returns a cleanup function that restores the original write methods.
 */
export function installNodeLogCapture(
    emitEvent: (name: string, payload: unknown) => void,
): () => void {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);

    (process.stdout as any).write = (chunk: any, ...args: any[]) => {
        emitEvent('node:log', { text: String(chunk) });
        return origOut(chunk, ...args);
    };
    (process.stderr as any).write = (chunk: any, ...args: any[]) => {
        emitEvent('node:err', { text: String(chunk) });
        return origErr(chunk, ...args);
    };

    return () => {
        (process.stdout as any).write = origOut;
        (process.stderr as any).write = origErr;
    };
}
