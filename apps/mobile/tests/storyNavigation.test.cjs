const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/stories/storyNavigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, require: () => ({}) });
const { openingPosition, nextPosition, previousPosition, relativeTime, applySeen, applyLiked, orderTray } = exported;

const group = (id, seen) => ({
  owner: { id, name: id, avatarUrl: null },
  isOwn: false,
  hasUnseen: seen.some((value) => !value),
  firstUnseenIndex: Math.max(0, seen.findIndex((value) => !value)),
  latestPublishedAt: '2026-09-16T00:00:00.000Z',
  stories: seen.map((value, index) => ({ id: `${id}${index}`, ownerId: id, contentType: 'image/jpeg', caption: null, publishedAt: '', expiresAt: '', seen: value, liked: false })),
});

const groups = [group('a', [true, false, false]), group('b', [true, true]), group('c', [false])];

test('opening a person starts at their first unseen Story, or the first when all are seen', () => {
  assert.deepEqual({ ...openingPosition(groups, 0) }, { group: 0, story: 1 });
  assert.deepEqual({ ...openingPosition(groups, 1) }, { group: 1, story: 0 });
});

test('next moves through a person, then to the next person, and closes after the last', () => {
  assert.deepEqual({ ...nextPosition(groups, { group: 0, story: 1 }) }, { group: 0, story: 2 });
  assert.deepEqual({ ...nextPosition(groups, { group: 0, story: 2 }) }, { group: 1, story: 0 });
  assert.equal(nextPosition(groups, { group: 2, story: 0 }), null);
});

test('previous goes back a Story, then to the previous person\'s last Story, and replays the very first', () => {
  assert.deepEqual({ ...previousPosition(groups, { group: 0, story: 2 }) }, { group: 0, story: 1 });
  assert.deepEqual({ ...previousPosition(groups, { group: 1, story: 0 }) }, { group: 0, story: 2 });
  assert.deepEqual({ ...previousPosition(groups, { group: 0, story: 0 }) }, { group: 0, story: 0 });
});

test('labels the time since posting like Instagram', () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  assert.equal(relativeTime('2026-09-16T11:59:30.000Z', now), 'now');
  assert.equal(relativeTime('2026-09-16T11:48:00.000Z', now), '12m');
  assert.equal(relativeTime('2026-09-16T07:00:00.000Z', now), '5h');
  assert.equal(relativeTime('2026-09-15T11:00:00.000Z', now), '1d');
});

test('seeing and liking update one Story and recompute the person\'s unseen state', () => {
  const seen = applySeen(groups, 'a1');
  assert.equal(seen[0].firstUnseenIndex, 2);
  assert.equal(seen[0].hasUnseen, true);
  const allSeen = applySeen(seen, 'a2');
  assert.equal(allSeen[0].hasUnseen, false);
  assert.equal(allSeen[1], groups[1], 'other people are untouched');
  assert.equal(applyLiked(groups, 'b1', true)[1].stories[1].liked, true);
});

test('orders the tray: you first, then unseen people newest first, then watched people', () => {
  const own = { ...group('me', [true]), isOwn: true, latestPublishedAt: '2026-09-16T01:00:00.000Z' };
  const oldUnseen = { ...group('old', [false]), latestPublishedAt: '2026-09-16T02:00:00.000Z' };
  const newUnseen = { ...group('new', [false]), latestPublishedAt: '2026-09-16T05:00:00.000Z' };
  const newestSeen = { ...group('seen', [true]), latestPublishedAt: '2026-09-16T09:00:00.000Z' };
  assert.deepEqual(Array.from(orderTray([newestSeen, oldUnseen, own, newUnseen]).map((item) => item.owner.id)), ['me', 'new', 'old', 'seen']);
});
