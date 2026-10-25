const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/notifications/systemNoticeModel.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsForTest });
const { isSystemNotice, systemNoticeOf } = exportsForTest;
const item = (title, body = '', extra = {}) => ({ id: 'notice', title, body, type: 'system', category: 'account', actor: null, target: null, isRead: false, createdAt: '2026-10-24T10:00:00Z', emoji: null, ...extra });

test('welcome opens Explore with introductory copy and preserves custom review text', () => {
  const verified = systemNoticeOf(item('Welcome to IEM Connect', 'Your college email is verified.'));
  assert.equal(verified.layout, 'welcome');
  assert.equal(verified.body, 'Meet people from your college. Start by exploring profiles.');
  assert.equal(verified.action.destination, 'explore');
  const unverified = systemNoticeOf(item('Welcome to IEM Connect'));
  assert.doesNotMatch(unverified.body, /verified|badge/i);
  const custom = systemNoticeOf(item('Welcome to IEM Connect', 'Your account is waiting for review.'));
  assert.equal(custom.body, 'Your account is waiting for review.');
});

test('sign-in notices retain the exact device and open active devices', () => {
  const notice = systemNoticeOf(item('New sign-in on a Samsung Galaxy S24', 'Not you? Tap to secure your account.'));
  assert.equal(notice.title, 'New sign-in');
  assert.match(notice.body, /a Samsung Galaxy S24/);
  assert.equal(notice.action.destination, 'sessions');
  assert.equal(notice.tone, 'security');
});

test('verification reminders preserve the server deadline and the paused-profile explanation', () => {
  for (const days of [1, 7, 30]) {
    const title = `Your college verification ends in ${days} ${days === 1 ? 'day' : 'days'}`;
    const notice = systemNoticeOf(item(title, 'Re-verify with your college email to keep your blue badge.'));
    assert.equal(notice.title, title);
    assert.equal(notice.action.destination, 'verification');
  }
  const paused = systemNoticeOf(item('Your profile is paused', "Others can't see you right now. Open the app to finish verifying and it unpauses at once - your matches and chats are still here."));
  assert.match(paused.body, /matches and chats are still available/);
  assert.match(paused.body, /hidden until you finish verification/);
});

test('review instructions stay intact instead of being replaced with generic copy', () => {
  const note = 'Retake the selfie in daylight. Keep both eyes visible.\nYour main photo must show your face.';
  for (const title of ['Please take a new selfie', "We couldn't verify you", "We couldn't change your birthday"]) {
    assert.equal(systemNoticeOf(item(title, note)).body, note);
  }
  assert.equal(systemNoticeOf(item('Please take a new selfie', note)).action.destination, 'selfie');
});

test('report review and action taken remain different outcomes', () => {
  const reviewed = systemNoticeOf(item('We reviewed your report', 'Thanks for helping keep IEM Connect safe.'));
  const acted = systemNoticeOf(item('Thanks - we acted on your report', 'Thanks for helping keep IEM Connect safe.'));
  assert.doesNotMatch(reviewed.body, /took action/);
  assert.match(acted.body, /took action/);
  assert.equal(reviewed.action, null);
  assert.equal(acted.action, null);
});

test('unknown and team notices preserve complete copy and do not invent an action', () => {
  const body = 'First paragraph.\nA complete second paragraph with instructions and a deadline of 30 October.';
  const unknown = systemNoticeOf(item('Important account update', body));
  assert.equal(unknown.title, 'Important account update');
  assert.equal(unknown.body, body);
  assert.equal(unknown.action, null);
  const team = systemNoticeOf(item('New feature', body, { type: 'team' }));
  assert.equal(team.body, body);
  assert.equal(team.label, 'App update');
  assert.equal(team.action, null);
});

test('profile media, birthday and verification results have distinct actions and status', () => {
  assert.equal(systemNoticeOf(item('One of your photos needs a look')).action.destination, 'edit_profile');
  assert.equal(systemNoticeOf(item('Your birthday was updated')).action.destination, 'profile');
  const checked = systemNoticeOf(item("You're verified as a real person ✓", 'Thanks - your photos match your selfie.'));
  assert.equal(checked.title, 'Selfie check complete');
  assert.equal(checked.body, 'Your profile photos match your selfie.');
  assert.equal(checked.icon, 'scan');
  const current = systemNoticeOf(item('Selfie check complete', 'Your profile photos match your selfie.'));
  assert.deepEqual(current, checked);
  assert.equal(checked.tone, 'success');
  assert.doesNotMatch(checked.body, /blue badge|unlimited/i);
  assert.equal(isSystemNotice(item('system')), true);
  assert.equal(isSystemNotice(item('a message', '', { category: 'messages', actor: { id: 'peer', name: 'Peer' } })), false);
});
