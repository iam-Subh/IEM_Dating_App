const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/profile/photoReorder.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { photoDropSlot, photoSlotPosition, movePhotoOrder, photoOrderMatches, photoActionTouch } = exported;
const size = { width: 100, height: 140, gap: 8 };

test('moving the main photo across rows preserves each photo identity and changes main only at the final order', () => {
  const original = ['a', 'b', 'c', 'd', 'e', 'f'];
  const hovering = movePhotoOrder(original, 'a', 2);
  const dropped = movePhotoOrder(hovering, 'a', 4);
  assert.deepEqual([...hovering], ['b', 'c', 'a', 'd', 'e', 'f']);
  assert.deepEqual([...dropped], ['b', 'c', 'd', 'e', 'a', 'f']);
  assert.deepEqual(original, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(new Set(dropped).size, original.length);
});

test('dragging a photo back restores its original position without stale slot offsets', () => {
  const original = ['a', 'b', 'c', 'd'];
  const forward = movePhotoOrder(original, 'a', 3);
  const backward = movePhotoOrder(forward, 'a', 0);
  assert.equal(photoOrderMatches(original, backward), true);
  assert.deepEqual({ ...photoSlotPosition(backward.indexOf('a'), size) }, { x: 0, y: 0 });
});

test('drop targets use the card position and exclude unfilled slots', () => {
  assert.equal(photoDropSlot(216, 148, 4, size), 3);
  assert.equal(photoDropSlot(-100, -100, 4, size), 0);
  assert.equal(photoDropSlot(108, 0, 6, size), 1);
  assert.equal(photoDropSlot(0, 148, 6, size), 3);
  assert.equal(photoDropSlot(54, 0, 6, size), 1);
});

test('unknown photos and unchanged targets cannot change the order', () => {
  const original = ['a', 'b', 'c'];
  assert.equal(movePhotoOrder(original, 'missing', 1), original);
  assert.equal(movePhotoOrder(original, 'b', 1), original);
  assert.deepEqual([...movePhotoOrder(original, 'c', -100)], ['c', 'a', 'b']);
  assert.deepEqual([...movePhotoOrder(original, 'a', 100)], ['b', 'c', 'a']);
});

test('photo options stay outside the image drag area in every grid slot', () => {
  assert.equal(photoActionTouch(94, 12, size), false);
  assert.equal(photoActionTouch(90, 130, size), true);
  assert.equal(photoActionTouch(10, 130, size), true);
  assert.equal(photoActionTouch(50, 70, size), false);
});

test('the status strip below the image cannot start a reorder', () => {
  assert.equal(photoActionTouch(50, 90, size, true), true);
  assert.equal(photoActionTouch(50, 90, size, false), false);
  assert.equal(photoActionTouch(30, 60, size, true), false);
});

const options = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/profile/profilePhotoOptionsRequests.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: options });

test('photo options retain the selected photo identity and execute only once', () => {
  const first = options.createPhotoOptionsRequest('photo-a');
  const second = options.createPhotoOptionsRequest('photo-b');
  options.selectPhotoOption(first, 'crop');
  options.selectPhotoOption(second, 'remove');
  assert.deepEqual({ ...options.takePhotoOption(second) }, { photoId: 'photo-b', action: 'remove' });
  assert.deepEqual({ ...options.takePhotoOption(first) }, { photoId: 'photo-a', action: 'crop' });
  assert.equal(options.takePhotoOption(first), null);
});

test('dismissing photo options cannot apply an old selection later', () => {
  const request = options.createPhotoOptionsRequest('photo-a');
  assert.equal(options.takePhotoOption(request), null);
  options.selectPhotoOption(request, 'remove');
  assert.equal(options.takePhotoOption(request), null);
});
