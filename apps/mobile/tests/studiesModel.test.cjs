const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/edit/studiesModel.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: exported});
const {parseStudies, formatStudyYear, studiesSummary} = exported;

test('Studies follows onboarding: a degree, a graduation year from 2020, an optional year of study', () => {
  const result = parseStudies({degree: '  Bachelor of Architecture  ', yearOfStudy: '5', graduationYear: '2037'});
  assert.equal(Object.keys(result.errors).length, 0);
  assert.equal(result.values.degree, 'Bachelor of Architecture');
  assert.equal(result.values.yearOfStudy, 5);
  assert.equal(result.values.graduationYear, 2037);
  // Year of study may be left empty, as in onboarding - and is then not sent.
  const noYear = parseStudies({degree: 'MBA', yearOfStudy: '', graduationYear: '2027'});
  assert.equal(Object.keys(noYear.errors).length, 0);
  assert.equal('yearOfStudy' in noYear.values, false);
});

test('Degree and graduation year are required', () => {
  const result = parseStudies({degree: ' ', yearOfStudy: '', graduationYear: ''});
  assert.ok(result.errors.degree);
  assert.equal(result.errors.yearOfStudy, undefined);
  assert.ok(result.errors.graduationYear);
});

test('Studies rejects partial, nonnumeric, and out-of-range years', () => {
  for (const value of ['0', '11', '3.5', '-1', '3rd']) assert.ok(parseStudies({degree: 'B.Tech', yearOfStudy: value, graduationYear: '2027'}).errors.yearOfStudy);
  for (const value of ['202', '2027x', '2019', '2101']) assert.ok(parseStudies({degree: 'B.Tech', yearOfStudy: '', graduationYear: value}).errors.graduationYear);
});

test('Study summaries use ordinal year labels and omit missing values', () => {
  for (const [year, label] of [[1, '1st year'], [2, '2nd year'], [3, '3rd year'], [4, '4th year'], [11, '11th year'], [12, '12th year'], [13, '13th year'], [21, '21st year']]) assert.equal(formatStudyYear(year), label);
  assert.equal(studiesSummary({degree: 'B.Tech', yearOfStudy: 3, graduationYear: 2027}), 'B.Tech · 3rd year · 2027');
  assert.equal(studiesSummary({degree: 'MBA', graduationYear: 2018}), 'MBA · 2018');
  assert.equal(studiesSummary({}), '');
});
