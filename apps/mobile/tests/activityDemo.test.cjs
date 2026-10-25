const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/features/notifications/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: exported, setTimeout, clearTimeout });
  return exported;
}
const { activityUnread, countActivity, isSocialActivity, createActivityDemoStore } = load('activityModel');
const { buildSections, stackText, textOf, countNotifications } = load('notificationModel');
const make = (id, category, fields = {}) => ({ id, category, type: 'follow', title: '', body: '', emoji: null,
  createdAt: new Date().toISOString(), isRead: false, actor: null, target: null, ...fields });

test('Explore counts only unread follow and story activity', () => {
  const items = [make('f', 'follows'), make('s', 'stories'), make('read', 'stories', { isRead: true }),
    make('like', 'likes'), make('match', 'matches'), make('chat', 'messages'), make('account', 'account')];
  assert.equal(countActivity(items).total, 2);
  assert.deepEqual(items.filter(isSocialActivity).map(item => item.id), ['f', 's', 'read']);
  const result = activityUnread({ total: 40, byCategory: { follows: 2, stories: 3, likes: 10, matches: 5, messages: 19, account: 1 } });
  assert.equal(result.total, 5);
  assert.equal(result.byCategory.messages, 0);
});

test('the full notification feed counts every category and excludes read items', () => {
  const categories = ['likes', 'matches', 'messages', 'follows', 'stories', 'account'];
  const items = categories.map(category => make(category, category));
  items.push(make('read-message', 'messages', { isRead: true }));
  const result = countNotifications(items);
  assert.equal(result.total, 6);
  for (const category of categories) assert.equal(result.byCategory[category], 1);
});

test('demo arrivals share read state and stop after disabling the demo', () => {
  const scheduled = new Map();
  let timerId = 0;
  const store = createActivityDemoStore(() => [make('seed', 'follows')],
    () => [make('new', 'stories', { type: 'story_reply' })],
    (callback, milliseconds) => { const id = ++timerId; scheduled.set(id, { callback, milliseconds }); return id; },
    id => scheduled.delete(id));
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  const empty = store.getSnapshot();
  assert.equal(store.getSnapshot(), empty);
  store.enable();
  assert.equal(countActivity(store.getSnapshot().items).total, 1);
  const timer = [...scheduled.values()][0];
  assert.equal(timer.milliseconds, 4000);
  timer.callback();
  assert.equal(countActivity(store.getSnapshot().items).total, 2);
  const latest = store.getSnapshot().latestId;
  store.update(items => items.map(item => ({ ...item, isRead: true })));
  assert.equal(countActivity(store.getSnapshot().items).total, 0);
  assert.equal(store.getSnapshot().latestId, latest);
  store.arrive();
  assert.equal(countActivity(store.getSnapshot().items).total, 1);
  assert.notEqual(store.getSnapshot().latestId, latest);
  assert.equal(new Set(store.getSnapshot().items.map(item => item.id)).size, 3);
  store.disable();
  assert.equal(scheduled.size, 0);
  timer.callback();
  assert.equal(store.getSnapshot().items.length, 0);
  unsubscribe();
  const before = updates;
  store.enable();
  assert.equal(updates, before);
  store.disable();
});

test('story likes stack by story while replies remain separate', () => {
  const actor = id => ({ id, name: id, avatarUrl: null });
  const story = storyId => ({ kind: 'story', storyId });
  const likes = [make('1', 'stories', { type: 'story_like', actor: actor('Maya'), target: story('a') }),
    make('2', 'stories', { type: 'story_like', actor: actor('Rohan'), target: story('a') })];
  const rows = buildSections([...likes, make('3', 'stories', { type: 'story_like', target: story('b') }),
    make('4', 'stories', { type: 'story_reply', actor: actor('Aanya'), target: story('a'), body: 'Where was this taken?' })])[0].rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, 'stack');
  assert.equal(rows[0].items.length, 2);
  assert.equal(stackText(likes).rest, 'and 1 other liked your story');
  assert.equal(rows[2].item.body, 'Where was this taken?');
  assert.equal(textOf(rows[2].item).rest, 'replied to your story');
});
