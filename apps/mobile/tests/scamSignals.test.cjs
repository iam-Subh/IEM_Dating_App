const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/safety/scamSignals.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports });
  return module.exports;
}

test('links, numbers, payment apps and money talk raise the chat safety note', () => {
  const { looksRisky } = load();
  for (const text of [
    'check this https://bit.ly/x', 'join me on telegram', 'msg me on whatsapp', 'my number is 98765 43210',
    'can you send me ₹500', 'pay on gpay', 'my upi is abc@okaxis', 'I trade crypto, double your money', 'need money urgently',
  ]) assert.equal(looksRisky(text), true, text);
});

test('everyday chat does not', () => {
  const { looksRisky } = load();
  for (const text of ['Coffee after class?', 'See you at 5 near gate 2', 'I scored 92 in the test', 'haha that movie was so good', '', null]) {
    assert.equal(looksRisky(text), false, String(text));
  }
});

function loadHurtful() {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/safety/hurtfulLanguage.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, RegExp });
  return module.exports;
}

test('hurtful words are caught however they are spelt; ordinary words are not', () => {
  const { looksHurtful } = loadHurtful();
  for (const text of ['you are such a b1tch', 'SEND NUDES', 'send nuuuudes pls', 'chutiya hai tu', 'tui ekta bokachoda', 'f u c k you', 'kys', 'go die']) {
    assert.equal(looksHurtful(text), true, text);
  }
  for (const text of ['I love McDonalds', 'grab a coffee?', 'my mom is a doctor', 'that match was intense', 'what is your class schedule', 'scunthorpe united', '', null]) {
    assert.equal(looksHurtful(text), false, String(text));
  }
});

test('Hidden Words match whole words or phrases, any case', () => {
  const { containsHidden } = loadHurtful();
  assert.equal(containsHidden('Are you SINGLE?', ['single']), true);
  assert.equal(containsHidden('singles night', ['single']), false);
  assert.equal(containsHidden('hey what is your insta', ['your insta']), true);
  assert.equal(containsHidden('anything', []), false);
});
