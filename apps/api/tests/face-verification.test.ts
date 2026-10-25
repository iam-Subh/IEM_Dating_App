/**
 * The real-person check (apps/mobile/src/features/verification/PHOTO_VERIFICATION_PLAN.md).
 *
 * No database. The face-service tests run when FACE_SERVICE_URL answers
 * (docker compose up face) and are skipped otherwise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { EXTRA_PHOTO_DISTANCE, MATCH_DISTANCE, SIDE_YAW, TURN_DISTANCE, UNSURE_DISTANCE, distance, effectiveStatus, openDescriptor, sealDescriptor, verdict, type Face } from '../src/services/face-verification.service';

const service = (process.env.FACE_SERVICE_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'faces', name)).toString('base64');

test('an extra photo just over the strict line counts as them; the main photo and the video do not', () => {
  assert.ok(MATCH_DISTANCE < EXTRA_PHOTO_DISTANCE && EXTRA_PHOTO_DISTANCE <= UNSURE_DISTANCE);
  // The real cases: second photos of the same person at 0.505 and 0.556.
  assert.equal(effectiveStatus({ kind: 'photo', main: false, status: 'unsure', distance: 0.505 }), 'match');
  assert.equal(effectiveStatus({ kind: 'photo', main: false, status: 'unsure', distance: 0.556 }), 'match');
  assert.equal(effectiveStatus({ kind: 'photo', main: true, status: 'unsure', distance: 0.505 }), 'unsure', 'the main photo keeps the strict line');
  assert.equal(effectiveStatus({ kind: 'video', main: false, status: 'unsure', distance: 0.505 }), 'unsure');
  assert.equal(effectiveStatus({ kind: 'photo', main: false, status: 'mismatch', distance: 0.7 }), 'mismatch');
});

/** A face this far (by distance) from a key of zeros, turned by `yaw`. */
function faceAt(away: number, yaw: number): Face {
  const descriptor = Array.from({ length: 128 }, () => 0);
  descriptor[0] = away;
  return { box: [0, 0, 1, 1], descriptor, eyeOpen: 0.3, yaw, smile: 0.4 };
}
const zeros = Array.from({ length: 128 }, () => 0);

test('a side-view photo is them when it is within the turn line; a front view is held to the strict lines', () => {
  assert.ok(UNSURE_DISTANCE < TURN_DISTANCE);
  // The measured case: a full side view of the same person, 0.63-0.66 from the front.
  assert.equal(verdict([faceAt(0.65, SIDE_YAW + 0.2)], zeros).status, 'side');
  assert.equal(verdict([faceAt(0.65, 0.02)], zeros).status, 'mismatch', 'facing the camera, 0.65 is someone else');
  assert.equal(verdict([faceAt(0.82, SIDE_YAW + 0.2)], zeros).status, 'mismatch', 'too far even for a side view');
  assert.equal(verdict([faceAt(0.45, SIDE_YAW + 0.2)], zeros).status, 'match');
  // As an extra photo a side view counts; as the main photo the team looks.
  assert.equal(effectiveStatus({ kind: 'photo', main: false, status: 'side', distance: 0.65 }), 'match');
  assert.equal(effectiveStatus({ kind: 'photo', main: true, status: 'side', distance: 0.65 }), 'unsure');
});

async function serviceUp() {
  try { return (await fetch(`${service}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

test('the face key is sealed: unreadable at rest, the same numbers back', () => {
  const key = Array.from({ length: 128 }, (_, index) => Math.sin(index) / 4);
  const sealed = sealDescriptor(key);
  assert.ok(!sealed.includes('0.2'), 'no plain numbers in what is stored');
  assert.deepEqual(openDescriptor(sealed), key);
  assert.notEqual(sealDescriptor(key), sealed, 'a fresh nonce every time');
  const [iv, tag, body] = sealed.split('.');
  const tampered = [iv, tag, Buffer.from('x' + Buffer.from(body, 'base64').toString('latin1').slice(1), 'latin1').toString('base64')].join('.');
  assert.throws(() => openDescriptor(tampered), 'a changed key is refused, not misread');
});

test('the lines are in order', () => {
  assert.ok(MATCH_DISTANCE < UNSURE_DISTANCE);
  assert.equal(distance([0, 0], [3, 4]), 5);
});

test('the face service: same person matches, a different person does not', async (t) => {
  if (!(await serviceUp())) return t.skip('face service not running');
  const response = await fetch(`${service}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: ['person-a-1.jpg', 'person-a-2.jpg', 'person-b-1.jpg'].map(fixture) }),
  });
  const body = await response.json() as { images: { faces: { descriptor: number[]; eyeOpen: number; yaw: number; smile: number }[] }[] };
  assert.deepEqual(body.images.map((image) => image.faces.length), [1, 1, 1]);
  const [a1, a2, b1] = body.images.map((image) => image.faces[0].descriptor);
  assert.ok(distance(a1, a2) <= MATCH_DISTANCE, `same person: ${distance(a1, a2).toFixed(3)}`);
  assert.ok(distance(a1, b1) > UNSURE_DISTANCE, `different people: ${distance(a1, b1).toFixed(3)}`);
  for (const image of body.images) {
    const face = image.faces[0];
    assert.ok(face.eyeOpen > 0 && Number.isFinite(face.yaw) && face.smile > 0, 'landmark measures for the liveness re-check');
  }
});

test('the face service refuses what is not an image', async (t) => {
  if (!(await serviceUp())) return t.skip('face service not running');
  const response = await fetch(`${service}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: [Buffer.from('not an image').toString('base64')] }),
  });
  assert.equal(response.status, 400);
});
