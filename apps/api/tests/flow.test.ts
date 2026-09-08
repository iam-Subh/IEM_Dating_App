import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app';

test('health reports a running HTTP service', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.ok(Number.isFinite(Date.parse(response.body.timestamp)));
});

test('profile data requires an access token', async () => {
  const response = await request(app).get('/api/v1/profile');
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test('match data requires an access token', async () => {
  const response = await request(app).get('/api/v1/match/pending');
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test('swipe writes require an access token', async () => {
  const response = await request(app).post('/api/v1/match/swipe').send({ targetId: 'invalid', action: 'like' });
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});
