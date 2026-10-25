const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createChatLab } = require('../serve-chat-lab.cjs');
const matchId = '11111111-1111-1111-1111-111111111111';
const setup = { email: 'partner@example.test', password: 'not-a-real-password', matchId, phone: { id: 'phone', email: 'phone@example.test', name: 'Phone' } };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
async function harness(t, fetchMock) {
  const requests = [];
  const server = createChatLab({ port: 0, phoneEmail: setup.phone.email, prepare: async () => setup, fetch: async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/auth/login')) return json({ data: { user: { id: 'partner' }, accessToken: 'access', refreshToken: 'refresh' } });
    return fetchMock ? fetchMock(url, init) : json({ success: true, data: { messages: [] } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(origin + '/lab/config')).json();
  const headers = { 'X-Chat-Lab': config.nonce, Authorization: 'Bearer access' };
  return { origin, headers, requests, async connect() { const response = await fetch(origin + '/lab/connect', { method: 'POST', headers }); assert.equal(response.status, 200); return response.json(); } };
}
test('localhost page serves and pairs only the configured phone account', async t => {
  const h = await harness(t);
  assert.equal((await fetch(h.origin)).status, 200);
  const result = await h.connect(); assert.equal(result.phone.email, setup.phone.email);
  assert.equal(result.password, undefined);
  const response = await fetch(h.origin + `/api/v1/chat/${matchId}/messages`, { headers: h.headers });
  assert.equal(response.status, 200);
  assert.equal(h.requests[0].init.body.includes(setup.password), true); // Password goes to the real login API only.
});
test('cross-origin access, missing nonce and other conversation routes are refused', async t => {
  const h = await harness(t);
  assert.equal((await fetch(h.origin + '/lab/config', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(h.origin + '/lab/connect', { method: 'POST' })).status, 403);
  await h.connect(); const before = h.requests.length;
  assert.equal((await fetch(h.origin + '/api/v1/chat/22222222-2222-2222-2222-222222222222/messages', { headers: h.headers })).status, 403);
  assert.equal((await fetch(h.origin + '/api/v1/profile/me', { headers: h.headers })).status, 403);
  assert.equal((await fetch(h.origin + '/lab/media?key=chat-media-approved/other/file.jpeg', { headers: h.headers })).status, 403);
  assert.equal(h.requests.length, before);
});
test('upload bridge sends the bytes through a real-style ticket and completion sequence', async t => {
  const bytes = Buffer.from('sample-file-bytes'); let received;
  const h = await harness(t, async (url, init) => {
    if (url.includes('/media/upload-url?ext=txt')) return json({ data: { assetId: 'asset', uploadUrl: 'https://storage.example.test/signed', contentType: 'text/plain' } });
    if (url === 'https://storage.example.test/signed') { const chunks = []; for await (const chunk of init.body) chunks.push(chunk); received = Buffer.concat(chunks); return new Response(null, { status: 200 }); }
    if (url.includes('/media/asset/complete')) return json({ success: true, data: { mediaKey: 'approved-key' } });
    throw new Error('Unexpected route');
  });
  await h.connect();
  const response = await fetch(h.origin + '/lab/upload?ext=txt', { method: 'POST', headers: h.headers, body: bytes });
  assert.equal(response.status, 200); assert.deepEqual(received, bytes);
  assert.equal((await response.json()).data.mediaKey, 'approved-key');
  assert.equal(h.requests.some(request => /\/messages$/.test(request.url)), false); // Upload is not a send.
});
test('setup failures do not expose child-process credentials', async t => {
  const server = createChatLab({ port: 0, prepare: async () => { throw Object.assign(new Error('private password'), { cmd: 'setup', stdout: 'private password' }); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(origin + '/lab/config')).json();
  const response = await fetch(origin + '/lab/connect', { method: 'POST', headers: { 'X-Chat-Lab': config.nonce } });
  assert.equal(response.status, 502); assert.equal((await response.text()).includes('private password'), false);
});

const moduleBox = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../../docs/design-review/chat-lab/model.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleBox, exports: moduleBox.exports });
const { pcmWav, sampleGif, receiptLabel, mergeReceiptMessage } = moduleBox.exports;
test('recorded audio becomes a valid mono PCM WAV with clipped samples', () => {
  const wav = new DataView(pcmWav(new Float32Array([-2, -1, 0, 1, 2]), 16000));
  assert.equal(wav.getUint32(24, true), 16000); assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getInt16(44, true), -32768); assert.equal(wav.getInt16(52, true), 32767);
  assert.equal(wav.getUint32(40, true), 10);
});
test('generated GIF decodes as two animated frames', async () => {
  const sharp = require('sharp');
  const metadata = await sharp(Buffer.from(sampleGif()), { animated: true }).metadata();
  assert.equal(metadata.width, 64); assert.equal(metadata.pages, 2); assert.equal(metadata.pageHeight, 64);
});
test('late message echoes do not erase confirmed receipts', () => {
  const merged = mergeReceiptMessage({ id: 'a', readAt: 'read', deliveredAt: 'delivered', playedAt: 'played' }, { id: 'a', readAt: null, deliveredAt: null });
  assert.equal(merged.readAt, 'read'); assert.equal(merged.deliveredAt, 'delivered'); assert.equal(merged.playedAt, 'played');
  assert.equal(receiptLabel(merged), 'Read'); assert.equal(receiptLabel({ localStatus: 'failed' }), 'Failed');
});
