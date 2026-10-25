const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(get) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../src/features/auth/onboarding/collegeOptions.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports, require: () => ({api: {get}})});
  return exports;
}
test('review and college editor share the same request and cached campus options', async () => {
  let calls = 0;
  const api = load(async () => {
    calls++;
    return {data: {data: [{id: 'iem', code: 'IEM-KOLKATA', campusList: [{id: 'one', name: 'Gurukul'}]}, {id: 'other', code: 'OTHER'}]}};
  });
  const fromReview = api.loadCollegeOptions();
  assert.equal(fromReview, api.loadCollegeOptions());
  const options = await fromReview;
  assert.equal(options.length, 1);
  assert.equal(api.cachedCollegeOptions(), options);
  assert.equal(await api.loadCollegeOptions(), options);
  assert.equal(calls, 1);
  await api.loadCollegeOptions(true);
  assert.equal(calls, 2);
});
test('failed college prefetch can retry when the editor opens', async () => {
  let fail = true;
  const api = load(async () => {
    if (fail) throw new Error('offline');
    return {data: {data: [{id: 'uem', code: 'UEM-KOLKATA'}]}};
  });
  await assert.rejects(api.loadCollegeOptions(), /offline/);
  fail = false;
  assert.equal((await api.loadCollegeOptions())[0].id, 'uem');
});
