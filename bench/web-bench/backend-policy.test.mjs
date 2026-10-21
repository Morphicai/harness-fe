import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { backendDocumentPolicy } from './backend-policy.mjs';

test('document navigation preserves backend redirect/authentication, while assets and APIs pass through', async () => {
    const marker = randomUUID(), requests = [];
    const backend = createServer((req, res) => {
        requests.push({ url: req.url, cookie: req.headers.cookie });
        if (req.url === '/restricted') { res.writeHead(302, { location: '/sign-in', 'set-cookie': `probe=${marker}; Path=/` }); res.end(); }
        else if (req.url === '/denied') { res.writeHead(403); res.end('denied'); }
        else { res.writeHead(404); res.end('No built development HTML'); }
    });
    await new Promise(r => backend.listen(0, '127.0.0.1', r));
    const policy = backendDocumentPolicy(`http://127.0.0.1:${backend.address().port}`);
    async function request(url, accept = 'text/html') {
        let next = false, body;
        const headers = {}, response = { setHeader: (k, v) => { headers[k] = v; }, end: v => { body = v; } };
        await policy({ method: 'GET', url, headers: { accept, cookie: `probe=${marker}` } }, response, () => { next = true; });
        return { next, body, status: response.statusCode, headers };
    }
    try {
        const redirect = await request('/restricted');
        assert.equal(redirect.status, 302); assert.equal(redirect.headers.location, '/sign-in'); assert.equal(redirect.next, false);
        assert.ok(redirect.headers['set-cookie'][0].includes(marker)); assert.equal(requests[0].cookie, `probe=${marker}`);
        assert.equal((await request('/denied')).status, 403);
        assert.equal((await request('/ordinary-client-route')).next, true);
        const before = requests.length;
        assert.equal((await request('/api/data')).next, true);
        assert.equal((await request('/src/main.tsx', '*/*')).next, true);
        assert.equal(requests.length, before, 'API/module requests must not be duplicated');
    } finally { backend.closeAllConnections(); await new Promise(r => backend.close(r)); }
});
