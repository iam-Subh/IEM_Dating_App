const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const model = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/standoutsIconMotion.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: model});
const {standoutsCardPose: pose, STANDOUTS_CARD_SIZE: card, STANDOUTS_ICON_FRAME: frame} = model;
function bounds(p) {
  const radians = p.rotation * Math.PI / 180;
  const halfWidth = (card.width * Math.abs(Math.cos(radians)) + card.height * Math.abs(Math.sin(radians))) / 2;
  const halfHeight = (card.height * Math.abs(Math.cos(radians)) + card.width * Math.abs(Math.sin(radians))) / 2;
  return {left: p.x + card.width / 2 - halfWidth, right: p.x + card.width / 2 + halfWidth,
    top: p.y + card.height / 2 - halfHeight, bottom: p.y + card.height / 2 + halfHeight};
}

test('both cards stay inside a fixed frame throughout the complete loop', () => {
  for (let tick = 0; tick <= 400; tick++) for (const index of [0, 1]) {
    const p = pose(index, tick / 200), b = bounds(p);
    assert.ok(b.left >= 0 && b.top >= 0 && b.right <= frame.width && b.bottom <= frame.height);
    assert.equal('scale' in p, false);
  }
});

test('the cards exchange depth only while fully separated', () => {
  for (const turn of [0, 1]) {
    const before = [pose(0, turn + 0.419), pose(1, turn + 0.419)];
    const after = [pose(0, turn + 0.421), pose(1, turn + 0.421)];
    assert.equal(before.filter(p => p.front).length, 1);
    assert.notEqual(before[0].front, after[0].front);
    for (const pair of [before, after]) {
      const boxes = pair.map(bounds).sort((a, b) => a.left - b.left);
      assert.ok(boxes[0].right + 12 < boxes[1].left);
    }
  }
});

test('the incoming heart reveals only after its card reaches the front position', () => {
  for (const turn of [0, 1]) {
    const index = (turn + 1) % 2;
    assert.equal(pose(index, turn + 0.75).heart, 0);
    const revealing = pose(index, turn + 0.83);
    assert.equal(revealing.x, 74); assert.equal(revealing.y, 34);
    assert.equal(Math.abs(revealing.rotation), 0); assert.equal(revealing.front, true);
    assert.ok(revealing.heart > 0 && revealing.heart < 1);
    assert.equal(pose(index, turn + 0.95).heart, 1);
  }
});

test('both transfers and the loop reset preserve position and heart state', () => {
  for (const end of [1, 2]) for (const index of [0, 1]) {
    const before = pose(index, end - 0.000001), after = pose(index, end);
    for (const key of ['x', 'y', 'rotation', 'heart']) assert.ok(Math.abs(before[key] - after[key]) < 0.001);
  }
  for (const path of model.STANDOUTS_CARD_PATHS) for (const values of Object.values(path)) {
    assert.equal(values[0], values.at(-1));
  }
});
