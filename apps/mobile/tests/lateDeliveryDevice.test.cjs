const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/notifications/push/lateDelivery.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

function device(constants, os = 'android') {
  const exported = {};
  vm.runInNewContext(source, {exports: exported, require: name => name === 'react-native' ? {Platform: {OS: os, constants}} : {}});
  return exported;
}

test('brand-specific phones use their own name and settings family', () => {
  for (const [Brand, Manufacturer, label, maker] of [
    ['realme', 'OPPO', 'Realme', 'realme'],
    ['OnePlus', 'OPPO', 'OnePlus', 'oneplus'],
    ['POCO', 'Xiaomi', 'Poco', 'xiaomi'],
    ['Redmi', 'Xiaomi', 'Redmi', 'xiaomi'],
    ['iQOO', 'vivo', 'iQOO', 'vivo'],
    ['samsung', 'samsung', 'Samsung', 'samsung'],
  ]) {
    const phone = device({Brand, Manufacturer});
    assert.equal(phone.phoneBrand(), label);
    assert.equal(phone.phoneMaker(), maker);
  }
});

test('missing brand falls back to the manufacturer without inventing a brand', () => {
  const fallback = device({Brand: 'unknown', Manufacturer: 'OPPO'});
  assert.equal(fallback.phoneBrand(), 'Oppo');
  assert.equal(fallback.phoneMaker(), 'oppo');
  const missing = device({});
  assert.equal(missing.phoneBrand(), null);
  assert.equal(missing.phoneMaker(), 'other');
});

test('other brands keep their reported name; non-Android platforms have no Android brand', () => {
  const other = device({Brand: 'Fairphone', Manufacturer: 'Fairphone'});
  assert.equal(other.phoneBrand(), 'Fairphone');
  assert.equal(other.phoneMaker(), 'other');
  const ios = device(undefined, 'ios');
  assert.equal(ios.phoneBrand(), null);
  assert.equal(ios.phoneMaker(), 'other');
});
