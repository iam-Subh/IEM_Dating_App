const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const model = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/features/teaching/swipeLessonModel.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: model});

test('a short or cancelled drag does not count, even with noisy release velocity', () => {
  assert.equal(model.practiceDecision(10, 2, 350), null);
  assert.equal(model.practiceDecision(-10, -2, 350), null);
  assert.equal(model.practiceDecision(70, 0, 350), null);
});
test('distance and deliberate flick work in both directions', () => {
  assert.equal(model.practiceDecision(80, 0, 350), 'like');
  assert.equal(model.practiceDecision(-80, 0, 350), 'pass');
  assert.equal(model.practiceDecision(30, 1, 350), 'like');
  assert.equal(model.practiceDecision(-30, -1, 350), 'pass');
  assert.equal(model.practiceDecision(30, -1, 350), null);
});
test('completion requires both directions; repeated Likes cannot complete it', () => {
  let mask = model.recordPractice(0, 'like');
  assert.equal(mask, 1);
  mask = model.recordPractice(mask, 'like');
  assert.equal(mask, 1);
  assert.equal(model.practiceInstruction(mask), 'Now swipe left to Pass.');
  assert.equal(model.recordPractice(mask, 'pass'), 3);
  assert.equal(model.recordPractice(model.recordPractice(0, 'pass'), 'like'), 3);
});
