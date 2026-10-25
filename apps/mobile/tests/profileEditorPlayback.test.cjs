const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports });
  return exports;
}

const { heightSelectionIndex, HEIGHT_ROW_SIZE, MIN_HEIGHT, MAX_HEIGHT } = load('../src/screens/main/edit/heightPickerSelection.ts');
const { clampPlaybackTime, playbackClock, createLiveVideoSeekQueue, matchesPendingVideoSeek } = load('../src/screens/main/profile/profileVideoPlayback.ts');

test('only one complete height occupies the highlight at every point between rows', () => {
  for (let row = 0; row < MAX_HEIGHT - MIN_HEIGHT; row++) {
    for (const fraction of [0, 0.1, 0.49, 0.5, 0.51, 0.9]) {
      const index = heightSelectionIndex((row + fraction) * HEIGHT_ROW_SIZE);
      assert.equal(index, row + (fraction >= 0.5 ? 1 : 0));
      const highlightOffset = index * HEIGHT_ROW_SIZE;
      assert.equal(highlightOffset % HEIGHT_ROW_SIZE, 0);
    }
  }
});

test('height selection stays within the range during fast scroll and overscroll', () => {
  assert.equal(heightSelectionIndex(-600), 0);
  assert.equal(heightSelectionIndex(1e6), MAX_HEIGHT - MIN_HEIGHT);
  assert.equal(MIN_HEIGHT + heightSelectionIndex(105.51 * HEIGHT_ROW_SIZE), 197);
  assert.equal(heightSelectionIndex(Number.NaN), 0);
});

test('video seeks work in both directions and stay within the loaded duration', () => {
  const duration = 59.75;
  for (const [requested, expected] of [[45, 45], [12.5, 12.5], [-3, 0], [90, duration], [duration, duration]]) {
    assert.equal(clampPlaybackTime(requested, duration), expected);
  }
});

test('an unloaded video cannot seek to an invalid position', () => {
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(clampPlaybackTime(15, duration), 0);
  }
  assert.equal(clampPlaybackTime(Number.NaN, 60), 0);
  assert.equal(clampPlaybackTime(Number.POSITIVE_INFINITY, 60), 0);
});

test('the playback timer advances only after a full second', () => {
  assert.equal(playbackClock(0), '0:00');
  assert.equal(playbackClock(59.99), '0:59');
  assert.equal(playbackClock(60), '1:00');
  assert.equal(playbackClock(125.25), '2:05');
  assert.equal(playbackClock(Number.NaN), '0:00');
});

function seekHarness() {
  const seeks = [];
  const frames = new Map();
  let nextId = 0;
  const queue = createLiveVideoSeekQueue((seconds) => seeks.push(seconds), (callback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  }, (id) => frames.delete(id));
  return {
    queue, seeks,
    tick() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test('live scrubbing sends the first frame immediately and follows the latest direction', () => {
  const { queue, seeks, tick } = seekHarness();
  queue.move(4);
  assert.deepEqual(seeks, [4]);
  queue.move(8);
  queue.move(12);
  queue.move(3);
  tick();
  assert.deepEqual(seeks, [4, 3]);
  queue.move(9);
  tick();
  assert.deepEqual(seeks, [4, 3, 9]);
});

test('release seeks to the exact final time and cancels older queued requests', () => {
  const { queue, seeks, tick } = seekHarness();
  queue.move(2);
  queue.move(14);
  queue.finish(5.25);
  tick();
  assert.deepEqual(seeks, [2, 5.25]);
});

test('an unchanged final time still performs an exact seek after the fast preview', () => {
  const { queue, seeks, tick } = seekHarness();
  queue.move(7);
  queue.finish(7);
  tick();
  assert.deepEqual(seeks, [7, 7]);
});

test('closing the video cancels pending frame requests', () => {
  const { queue, seeks, tick } = seekHarness();
  queue.move(2);
  queue.move(14);
  queue.cancel();
  tick();
  assert.deepEqual(seeks, [2]);
});

test('a delayed seek cannot let old playback events reset the thumb in either direction', () => {
  const forward = { target: 12, startedAt: 100, resumes: true };
  assert.equal(matchesPendingVideoSeek(2, forward, 5000), false);
  assert.equal(matchesPendingVideoSeek(12.05, forward, 5000), true);
  const backward = { target: 2, startedAt: 100, resumes: false };
  assert.equal(matchesPendingVideoSeek(12, backward, 5000), false);
  assert.equal(matchesPendingVideoSeek(2, backward, 5000), true);
});

test('seek confirmation accepts playback progress but rejects positions beyond it', () => {
  const pending = { target: 6, startedAt: 1000, resumes: true };
  assert.equal(matchesPendingVideoSeek(6.3, pending, 1400), true);
  assert.equal(matchesPendingVideoSeek(10, pending, 1400), false);
  assert.equal(matchesPendingVideoSeek(Number.NaN, pending, 1400), false);
});
