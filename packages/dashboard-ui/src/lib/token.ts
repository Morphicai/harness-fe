/**
 * Read the auth token from the URL once at boot.
 *
 * The mcp-server's HTTP middleware accepts the token via either
 * `Authorization: Bearer …` or `?token=…`. The browser can't set
 * Authorization headers on the SPA's initial document load, so the URL
 * carries it. We capture it on first read and reuse it for every API
 * call + the WS handshake.
 */
function readTokenFromUrl(): string {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('token') ?? '';
}

let cached: string | null = null;
export function getToken(): string {
    if (cached === null) cached = readTokenFromUrl();
    return cached;
}

/** Build the WebSocket URL using the current page's host and the captured token. */
export function getWsUrl(): string {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${proto}//${host}${qs}`;
}
