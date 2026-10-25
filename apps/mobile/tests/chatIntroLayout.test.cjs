const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/chatLayout.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { matchIntroViewportInsets } = exported;

test('the last conversation starter can scroll above the message bar', () => {
  const viewport = matchIntroViewportInsets(80, 0, 300, 24);
  assert.equal(viewport.top, 0);
  // The scroll area ends 12 pixels before the measured message bar begins.
  assert.equal(viewport.bottom - 80, 12);
});

test('the intro stays below the header throughout keyboard and emoji panel movement', () => {
  const areaHeight = 680;
  for (const bottomInset of [0, 6, 24, 44]) {
    for (const panelHeight of [0, 40, 150, 290, 300]) {
      const composerHeight = 80;
      const viewport = matchIntroViewportInsets(composerHeight, panelHeight, 300, bottomInset);
      // ChatScreen moves both the list and composer by these existing transforms.
      const parentShift = -panelHeight + (Math.max(bottomInset, 6) - 4) * (panelHeight / 300);
      assert.equal(parentShift + viewport.top, 0);
      const introFloor = areaHeight + parentShift - viewport.bottom;
      const composerTop = areaHeight + parentShift - composerHeight;
      assert.equal(composerTop - introFloor, 12);
    }
  }
});

test('reply previews and multiline input preserve the gap as the message bar grows', () => {
  for (const composerHeight of [54, 80, 132, 210]) {
    for (const panelHeight of [0, 300]) {
      const viewport = matchIntroViewportInsets(composerHeight, panelHeight, 300, 24);
      assert.equal(viewport.bottom - composerHeight, 12);
    }
  }
});
