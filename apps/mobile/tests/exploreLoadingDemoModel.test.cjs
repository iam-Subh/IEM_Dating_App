const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const model = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/development/exploreLoadingDemoModel.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: model});
const phases = plan => Array.from(plan, step => `${step.at}:${step.phase}`);

test('app and preference demos delay the rings, then complete without another full cycle', () => {
  for (const scenario of ['open', 'preferences']) assert.deepEqual(phases(model.loadingDemoPlan(scenario)), ['0:warmup', '600:searching', '3500:ready']);
});
test('the location label changes to nearby search only after the simulated location result', () => {
  const plan = model.loadingDemoPlan('location');
  assert.deepEqual(phases(plan), ['0:warmup', '600:locating', '2200:searching', '4800:ready']);
  assert.equal(model.loadingDemoMessage('location', 'locating').title, 'Getting your location…');
  assert.equal(model.loadingDemoMessage('location', 'searching').title, 'Finding people nearby…');
});
test('slow loading gives an honest message at eight seconds and remains distinct from failure', () => {
  assert.deepEqual(phases(model.loadingDemoPlan('slow')), ['0:warmup', '600:searching', '8000:slow', '12000:ready']);
  assert.equal(model.loadingDemoMessage('slow', 'slow').detail, 'This is taking longer than usual.');
});
test('failure and empty results are separate; Retry can recover from the error demo', () => {
  assert.equal(model.loadingDemoPlan('error').at(-1).phase, 'error');
  assert.equal(model.loadingDemoPlan('empty').at(-1).phase, 'empty');
  assert.equal(model.loadingDemoPlan('error', true).at(-1).phase, 'ready');
});
test('an instant result has no loading interval', () => {
  assert.deepEqual(phases(model.loadingDemoPlan('instant')), ['0:ready']);
});
