const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const files = path.join(root, 'docs/design-review/chat-lab/dist');
const extensions = new Set('jpeg jpg png webp gif avif heic heif mp4 m4a wav pdf doc docx xls xlsx ppt pptx txt csv zip rar 7z'.split(' '));
const exec = promisify(execFile);

function createChatLab(options = {}) {
  const port = options.port ?? Number(process.env.CHAT_LAB_PORT || 8793);
  const apiOrigin = options.apiOrigin ?? process.env.CHAT_LAB_API ?? 'http://127.0.0.1:3000';
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiOrigin).hostname)) throw new Error('Chat Lab must connect to a local API server.');
  const phoneEmail = options.phoneEmail ?? process.env.CHAT_LAB_PHONE_EMAIL ?? 'Subhankar.Patra2024@iem.edu.in';
  const nonce = randomBytes(24).toString('base64url');
  let pair;
  let preparation;
  let sampleVideo;
  const prepare = options.prepare ?? (async () => {
    const result = await exec(process.execPath, [require.resolve('tsx/cli'), path.join(root, 'apps/api/scripts/setup-chat-lab.ts'), phoneEmail], {
      cwd: path.join(root, 'apps/api'), env: process.env, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  });
  const upstream = options.fetch ?? fetch;
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const allowedHost = host => ['localhost', '127.0.0.1', '[::1]'].some(name => host === `${name}:${server.address()?.port ?? port}`);
  const ownOrigin = origin => !origin || (() => { try { const url = new URL(origin); return url.protocol === 'http:' && allowedHost(url.host); } catch { return false; } })();
  const protectedRequest = req => {
    const supplied = String(req.headers['x-chat-lab'] ?? '');
    return supplied.length === nonce.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(nonce));
  };
  async function jsonBody(req) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 65_536) throw new Error('Request is too large.'); }
    return body ? JSON.parse(body) : {};
  }
  async function api(route, method, token, body) {
    const result = await upstream(`${apiOrigin}/api/v1${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const payload = await result.json();
    if (!result.ok) throw Object.assign(new Error(payload.message || `API returned ${result.status}`), { status: result.status });
    return payload;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:3000 ws://localhost:3000; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    if (!allowedHost(req.headers.host) || !ownOrigin(req.headers.origin)) return send(res, 403, { message: 'Open Chat Lab on this computer.' });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/lab/config' && req.method === 'GET') return send(res, 200, { phoneEmail, partnerEmail: 'chatlab.local@iem.edu.in', nonce, socketOrigin: apiOrigin });
      if (url.pathname.startsWith('/lab/') || url.pathname.startsWith('/api/')) {
        if (!protectedRequest(req)) return send(res, 403, { message: 'Reload this page before connecting.' });
        if (url.pathname === '/lab/connect' && req.method === 'POST') {
          if (!pair) {
            preparation ??= prepare().then(value => { pair = value; return value; }).catch(error => { preparation = null; throw error; });
            await preparation;
          }
          const login = await api('/auth/login', 'POST', null, { email: pair.email, password: pair.password, deviceInfo: { platform: 'web', name: 'Localhost Chat Lab' } });
          return send(res, 200, { ...login.data, matchId: pair.matchId, phone: pair.phone });
        }
        if (!pair) return send(res, 409, { message: 'Connect Chat Partner first.' });
        const token = req.headers.authorization;
        if (url.pathname === '/lab/sample/video' && req.method === 'GET') {
          sampleVideo ??= (async () => {
            const filename = path.join(os.tmpdir(), `iem-chat-lab-${randomBytes(8).toString('hex')}.mp4`);
            try {
              await exec(require('ffmpeg-static'), ['-y', '-f', 'lavfi', '-i', 'testsrc=size=480x480:rate=24:duration=4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', filename], { windowsHide: true, timeout: 30000 });
              return await fs.promises.readFile(filename);
            } catch { sampleVideo = null; throw new Error('Sample video generation failed. You can attach an MP4 file instead.'); }
            finally { await fs.promises.unlink(filename).catch(() => undefined); }
          })();
          const bytes = await sampleVideo;
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes); return;
        }
        if (url.pathname === '/lab/upload' && req.method === 'POST') {
          const ext = url.searchParams.get('ext');
          if (!extensions.has(ext) || !token) return send(res, 400, { message: 'Choose a supported attachment.' });
          const maxBytes = ext === 'mp4' ? 500 * 1024 * 1024 : ['m4a', 'wav'].includes(ext) ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
          if (Number(req.headers['content-length'] || 0) > maxBytes) return send(res, 413, { message: 'Attachment is too large.' });
          const ticket = (await api(`/chat/${pair.matchId}/media/upload-url?ext=${encodeURIComponent(ext)}`, 'GET', token)).data;
          let received = 0;
          const counter = new Transform({ transform(chunk, _encoding, done) { received += chunk.length; done(received > maxBytes ? new Error('Attachment is too large.') : null, chunk); } });
          req.on('aborted', () => counter.destroy(new Error('Upload cancelled.')));
          req.on('error', error => counter.destroy(error));
          req.pipe(counter);
          const uploaded = await upstream(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': ticket.contentType, ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}) }, body: counter, duplex: 'half', signal: AbortSignal.timeout(10 * 60_000) });
          if (!uploaded.ok) throw new Error(`Attachment upload failed (${uploaded.status}).`);
          const complete = await api(`/chat/${pair.matchId}/media/${ticket.assetId}/complete`, 'POST', token, {});
          return send(res, 200, complete);
        }
        if (url.pathname === '/lab/media' && req.method === 'GET') {
          const key = url.searchParams.get('key') ?? '';
          if (!key.startsWith(`chat-media-approved/${pair.matchId}/`) || !token) return send(res, 403, { message: 'Media is outside this test conversation.' });
          const signed = await api(`/chat/media/read?key=${encodeURIComponent(key)}`, 'GET', token);
          const media = await upstream(signed.data, { signal: AbortSignal.timeout(120_000) });
          if (!media.ok || !media.body) throw new Error('Media is unavailable.');
          res.writeHead(200, { 'Content-Type': media.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
          await pipeline(Readable.fromWeb(media.body), res);
          return;
        }
        if (url.pathname.startsWith('/api/v1/')) {
          const route = url.pathname.slice('/api/v1'.length);
          const matchPrefix = `/chat/${pair.matchId}/`;
          const chatRoute = route.startsWith(matchPrefix) && /^(messages(?:\/[0-9a-f-]{36}(?:\/(?:reaction|played))?)?|events|read|delivered)$/.test(route.slice(matchPrefix.length));
          const authRoute = ['/auth/refresh', '/auth/logout'].includes(route) && req.method === 'POST';
          if (!chatRoute && !authRoute) return send(res, 403, { message: 'This tool only opens its paired test conversation.' });
          const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await jsonBody(req) : undefined;
          const result = await api(route + url.search, req.method, token, body);
          return send(res, 200, result);
        }
        return send(res, 404, { message: 'Unknown test action.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { message: 'Method not allowed.' });
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const filename = path.resolve(files, relative);
      if (!filename.startsWith(files + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return send(res, 404, { message: 'Page not found.' });
      const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf' }[path.extname(filename)];
      if (!type) return send(res, 404, { message: 'File not served.' });
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filename).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      // Child process stdout can contain account credentials. Never return it in an error.
      send(res, error.status || 502, { message: error.cmd ? 'Could not prepare Chat Partner. Check the local API database and phone account.' : error.message });
    }
  });
  return server;
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production') throw new Error('Chat Lab is a development tool.');
  const port = Number(process.env.CHAT_LAB_PORT || 8793);
  createChatLab({ port }).listen(port, '127.0.0.1', () => console.log(`Chat Lab: http://localhost:${port}`));
}
module.exports = { createChatLab };
