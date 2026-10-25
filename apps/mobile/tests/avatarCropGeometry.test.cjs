const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/profile/avatarCropGeometry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { resizeAvatarCrop } = exported;
const start = { x: 100, y: 120, size: 160 };
const bounds = { width: 500, height: 600 };
const corners = [
  { corner: 'topLeft', dx: -40, dy: -40, expected: { x: 60, y: 80, size: 200 } },
  { corner: 'topRight', dx: 40, dy: -40, expected: { x: 100, y: 80, size: 200 } },
  { corner: 'bottomLeft', dx: -40, dy: 40, expected: { x: 60, y: 120, size: 200 } },
  { corner: 'bottomRight', dx: 40, dy: 40, expected: { x: 100, y: 120, size: 200 } },
];

for (const { corner, dx, dy, expected } of corners) {
  test(`${corner} enlarges the crop while the opposite corner stays fixed`, () => {
    const result = resizeAvatarCrop(start, corner, dx, dy, bounds, 80);
    assert.deepEqual({ ...result }, expected);
    assert.deepEqual(start, { x: 100, y: 120, size: 160 }, 'gesture snapshots must stay unchanged');
  });
}

test('every corner stays within the image and respects the minimum size', () => {
  for (const { corner, dx, dy } of corners) {
    for (const factor of [1000, -1000]) {
      const result = resizeAvatarCrop(start, corner, dx * factor, dy * factor, bounds, 80);
      assert.ok(result.size >= 80);
      assert.ok(result.x >= 0 && result.y >= 0);
      assert.ok(result.x + result.size <= bounds.width);
      assert.ok(result.y + result.size <= bounds.height);
      const left = corner.endsWith('Left');
      const top = corner.startsWith('top');
      assert.equal(result.x + (left ? result.size : 0), start.x + (left ? start.size : 0));
      assert.equal(result.y + (top ? result.size : 0), start.y + (top ? start.size : 0));
    }
  }
});

test('horizontal and vertical drags both resize a corner without changing the opposite corner', () => {
  for (const { corner, dx, dy } of corners) {
    assert.equal(resizeAvatarCrop(start, corner, dx, 0, bounds, 80).size, 180);
    assert.equal(resizeAvatarCrop(start, corner, 0, dy, bounds, 80).size, 180);
  }
});

test('small images use the available crop size instead of exceeding image bounds', () => {
  const result = resizeAvatarCrop({ x: 0, y: 0, size: 40 }, 'bottomRight', -100, -100, { width: 60, height: 40 }, 80);
  assert.deepEqual({ ...result }, { x: 0, y: 0, size: 40 });
});
