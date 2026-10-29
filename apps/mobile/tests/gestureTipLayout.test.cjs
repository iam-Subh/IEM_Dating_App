const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const model = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/features/teaching/gestureTipLayout.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: model});

test('the fingertip lands on the window target after the safe-area offset', () => {
  const layer = {x: 9, y: 28, width: 360, height: 756};
  const point = {x: 315, y: 580};
  const layout = model.gestureTipLayout(point, layer, 66);
  assert.equal(layer.x + layout.hand.left + model.TIP_FINGER_X, point.x);
  assert.equal(layer.y + layout.hand.top + model.TIP_FINGER_Y, point.y);
});
test('a longer caption cannot move the hand', () => {
  const layer = {x: 0, y: 24, width: 360, height: 756}, point = {x: 306, y: 580};
  const short = model.gestureTipLayout(point, layer, 48);
  const long = model.gestureTipLayout(point, layer, 100);
  assert.equal(short.hand.left, long.hand.left);
  assert.equal(short.hand.top, long.hand.top);
  assert.equal(short.caption.top + 48, long.caption.top + 100);
});
test('a header tip puts its caption below the hand without leaving the screen', () => {
  const layer = {x: 0, y: 24, width: 320, height: 600};
  const layout = model.gestureTipLayout({x: 230, y: 64}, layer, 80);
  assert.ok(layout.caption.top > layout.hand.top + model.TIP_HAND_HEIGHT);
  assert.ok(layout.caption.left >= 16);
  assert.ok(layout.caption.left + layout.caption.width <= 304);
  assert.ok(layout.caption.top + 80 <= 584);
});
test('a profile-arrow caption stops above the target and profile text', () => {
  const layout = model.gestureTipLayout({x: 306, y: 580}, {x: 0, y: 24, width: 360, height: 756}, 66);
  assert.equal(layout.caption.top + 66, layout.contact.y - 40);
  assert.ok(layout.caption.left + layout.caption.width <= 344);
});
