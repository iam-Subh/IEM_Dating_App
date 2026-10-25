const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/location/' + file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports, require: () => ({default: {getItem: async () => null, setItem: async () => {}}})});
  return exports;
}
const {createMapIntroductionTracker} = load('mapIntroductionState.ts');
const {paperIntroductionMotion} = load('mapIntroductionMotion.ts');
const {createPaperMesh, unfoldPaperMesh} = load('paperMesh.ts');

test('the introduction runs once per account and remains complete after restarting', async () => {
  const values = new Map();
  const storage = {getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value)};
  const first = createMapIntroductionTracker(storage);
  assert.equal(await first.needsIntroduction('account-a'), true);
  // Leaving before the animation finishes must not record completion.
  assert.equal(await first.needsIntroduction('account-a'), true);
  await first.complete('account-a');
  assert.equal(await first.needsIntroduction('account-a'), false);
  assert.equal(await first.needsIntroduction('account-b'), true);
  const restarted = createMapIntroductionTracker(storage);
  assert.equal(await restarted.needsIntroduction('account-a'), false);
  assert.equal(await restarted.needsIntroduction('account-b'), true);
});

test('a pending storage read cannot overwrite a completed introduction', async () => {
  let resolveRead;
  let reads = 0;
  const tracker = createMapIntroductionTracker({getItem: () => {reads++; return new Promise(resolve => {resolveRead = resolve;});}, setItem: async () => {}});
  const pending = tracker.needsIntroduction('account');
  assert.equal(tracker.needsIntroduction('account'), pending);
  assert.equal(reads, 1);
  await tracker.complete('account');
  resolveRead(null);
  assert.equal(await pending, false);
  assert.equal(tracker.hasSeen('account'), true);
});

test('storage failures do not block opening the map or repeat the introduction in this session', async () => {
  const tracker = createMapIntroductionTracker({getItem: async () => {throw new Error('read failed');}, setItem: async () => {throw new Error('write failed');}});
  assert.equal(await tracker.needsIntroduction('account'), true);
  const saving = tracker.complete('account');
  assert.equal(tracker.hasSeen('account'), true);
  assert.equal(await tracker.needsIntroduction('account'), false);
  await saving;
});

test('paper starts folded, opens fully, then scales without a second crunch', () => {
  assert.equal(paperIntroductionMotion(0).fold, 1);
  assert.equal(paperIntroductionMotion(0).rotation, 12);
  let previousFold = 1;
  for (let step = 0; step <= 100; step++) {
    const motion = paperIntroductionMotion(step / 100);
    assert.ok(motion.fold <= previousFold);
    if (motion.fold > 0) assert.equal(motion.expand, 0);
    previousFold = motion.fold;
  }
  assert.equal(paperIntroductionMotion(.68).fold, 0);
  assert.equal(paperIntroductionMotion(.75).expand, 0);
  assert.equal(paperIntroductionMotion(.96).expand, 1);
  assert.equal(paperIntroductionMotion(.96).rotation, 0);
  assert.equal(paperIntroductionMotion(1).opacity, 0);
});

test('paper mesh keeps shared edges closed and ends as an undistorted square', () => {
  const mesh = createPaperMesh();
  for (let step = 0; step <= 20; step++) {
    const frame = unfoldPaperMesh(mesh, step / 20, 300);
    const seen = new Map();
    mesh.faces.flat().forEach((node, index) => {
      const point = frame.vertices[index];
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      if (seen.has(node)) assert.deepEqual(point, seen.get(node));
      seen.set(node, point);
    });
  }
  const flat = unfoldPaperMesh(mesh, 1, 768);
  flat.vertices.forEach((point, index) => {
    assert.ok(Math.abs(point.x - mesh.textures[index].x) < .00001);
    assert.ok(Math.abs(point.y - mesh.textures[index].y) < .00001);
  });
  assert.ok(flat.colors.every(color => color === 'rgb(255,255,255)'));
});

test('motion remains defined for invalid progress and keeps each stage continuous', () => {
  for (const progress of [undefined, NaN, Infinity, -Infinity, -10, 10]) {
    assert.ok(Object.values(paperIntroductionMotion(progress)).every(Number.isFinite));
  }
  for (const boundary of [.08, .23, .38, .53, .65, .68, .75, .81, .9, .96, 1]) {
    const before = paperIntroductionMotion(boundary - .000001);
    const after = paperIntroductionMotion(boundary);
    for (const key of Object.keys(before)) assert.ok(Math.abs(before[key] - after[key]) < .001);
  }
});


test('all four tips start opening together before the sides relax', () => {
  const mesh = createPaperMesh();
  const frame = unfoldPaperMesh(mesh, .20, 300);
  const flattened = mesh.faces.flat();
  const progressAt = (x, y) => {
    const index = mesh.nodes.findIndex(node => node.flat.x === x && node.flat.y === y);
    const node = mesh.nodes[index];
    const actual = frame.vertices[flattened.indexOf(index)].x / 300 - .5;
    return (actual - node.ball.x) / (node.flat.x - node.ball.x);
  };
  const corners = [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]].map(([x, y]) => progressAt(x, y));
  for (const opened of corners) {
    assert.ok(opened > .10 && opened < .24);
    assert.ok(Math.abs(opened - corners[0]) < .00001);
  }
  assert.ok(Math.abs(progressAt(-.5, 0)) < .00001);
  assert.ok(Math.abs(progressAt(.5, 0)) < .00001);
});
