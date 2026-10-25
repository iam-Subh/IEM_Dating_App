const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/discoveryShuffleMotion.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: exported});
const pose = exported.discoveryShuffleMotion;

test('only the front card leaves the stack and it returns as the back card', () => {
  for (let turn = 0; turn < 3; turn++) {
    const front = turn;
    const middle = (turn + 1) % 3;
    const back = (turn + 2) % 3;
    assert.ok(pose(front, turn).zIndex > pose(middle, turn).zIndex);
    assert.ok(pose(front, turn + .46).x > 0);
    assert.equal(pose(middle, turn + .46).x, pose(back, turn + .46).x);
    assert.ok(pose(front, turn + .56).zIndex < pose(back, turn + .56).zIndex);
    assert.ok(pose(front, turn + 1).scale < pose(middle, turn + 1).scale);
  }
});

test('depth changes only when the rotated card is clear of both remaining cards', () => {
  const bounds = p => {
    const angle = p.rotation * Math.PI / 180;
    const halfWidth = (158 * Math.abs(Math.cos(angle)) + 210 * Math.abs(Math.sin(angle))) * p.scale / 2;
    return {left: p.x - halfWidth, right: p.x + halfWidth};
  };
  for (let turn = 0; turn < 3; turn++) {
    const front = bounds(pose(turn, turn + .5));
    for (const index of [(turn + 1) % 3, (turn + 2) % 3]) {
      assert.ok(front.left > bounds(pose(index, turn + .5)).right);
    }
  }
});

test('each transfer and the complete loop end without a position or scale jump', () => {
  for (let turn = 1; turn <= 6; turn++) {
    for (let index = 0; index < 3; index++) {
      const before = pose(index, turn - .000001);
      const after = pose(index, turn);
      for (const key of ['x', 'y', 'scale', 'rotation']) assert.ok(Math.abs(before[key] - after[key]) < .0001, `${turn}:${index}:${key}`);
    }
  }
});
