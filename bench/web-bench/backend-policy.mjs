/** Preserve backend document policy while Vite serves development HTML/modules. */
export function backendDocumentPolicy(target) {
    return async (req, res, next) => {
        if (req.method !== 'GET' || req.url?.startsWith('/api/') || !req.headers.accept?.includes('text/html')) return next();
        try {
            const headers = { accept: req.headers.accept };
            for (const key of ['cookie', 'authorization', 'host']) if (req.headers[key]) headers[key] = req.headers[key];
            const backend = await fetch(target + req.url, { redirect: 'manual', headers, signal: AbortSignal.timeout(5000) });
            if ((backend.status >= 300 && backend.status < 400) || [401, 403].includes(backend.status)) {
                res.statusCode = backend.status;
                if (backend.headers.has('location')) res.setHeader('location', backend.headers.get('location'));
                const cookies = backend.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
                res.end(await backend.text()); return;
            }
            await backend.body?.cancel(); next();
        } catch { next(); } // API failures remain visible through the API proxy.
    };
}
