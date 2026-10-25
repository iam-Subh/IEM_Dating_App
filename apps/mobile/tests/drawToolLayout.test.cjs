const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/features/stories/create/editor/drawToolLayout.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });

test('the complete story stays centered and clear of the header and drawing controls', () => {
  for (const [width, height, topInset, bottomInset] of [
    [320, 568, 24, 16], [360, 800, 28, 24], [393, 852, 59, 34],
    [430, 932, 59, 34], [800, 1280, 24, 24], [800, 360, 0, 24],
  ]) {
    const frame = exported.drawToolLayout(width, height, topInset, bottomInset);
    assert.ok(frame.top >= topInset + exported.DRAW_HEADER_HEIGHT + 8);
    assert.ok(frame.top + frame.height <= height - bottomInset - exported.DRAW_DOCK_HEIGHT - 8 + 0.001);
    assert.ok(frame.left >= 12);
    assert.ok(frame.left + frame.width <= width - 12 + 0.001);
    assert.ok(Math.abs(frame.left - (width - frame.left - frame.width)) < 0.001, 'equal space on both sides');
    assert.ok(Math.abs(frame.width / frame.height - 9 / 16) < 0.001);
  }
});
