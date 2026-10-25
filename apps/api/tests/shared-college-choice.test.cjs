const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/shared-college-choice.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: exportsObject});
const {canChooseSharedCollege: allowed} = exportsObject;
test('shared IEM email permits either Kolkata college regardless of matching preference completion', () => {
  for (const from of ['IEM-KOLKATA', 'UEM-KOLKATA']) for (const to of ['IEM-KOLKATA', 'UEM-KOLKATA']) assert.equal(allowed('student@IEM.EDU.IN', from, to), true);
});
test('shared college choice does not transfer unrelated memberships', () => {
  for (const email of [undefined, 'student@gmail.com', 'student@fakeiem.edu.in']) assert.equal(allowed(email, 'IEM-KOLKATA', 'UEM-KOLKATA'), false);
  assert.equal(allowed('student@iem.edu.in', 'UEM-JAIPUR', 'UEM-KOLKATA'), false);
  assert.equal(allowed('student@iem.edu.in', 'IEM-KOLKATA', 'UEM-JAIPUR'), false);
});
