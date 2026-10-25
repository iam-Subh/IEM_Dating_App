const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/profile/photoCropGeometry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { alignPhotoCrop, initialPhotoCrop, resizePhotoCrop, movePhotoCrop, photoCropPixels } = exported;
const bounds = { width: 400, height: 600 };
const start = { x: 100, y: 120, width: 160, height: 200 };

test('moving crop boundaries share exact screen pixels at fractional display densities', () => {
  for (const density of [1, 2, 2.625, 3]) {
    for (let step = 0; step < 20; step++) {
      const crop = {x: 10.17 + step * 0.13, y: 7.31 + step * 0.17, width: 120.43, height: 160.57};
      const aligned = alignPhotoCrop(crop, density);
      for (const edge of [aligned.x, aligned.y, aligned.x + aligned.width, aligned.y + aligned.height]) {
        assert.ok(Math.abs(edge * density - Math.round(edge * density)) < 1e-9);
      }
      assert.ok(Math.abs(aligned.x - crop.x) <= 0.5 / density);
      assert.ok(Math.abs(aligned.x + aligned.width - crop.x - crop.width) <= 0.5 / density);
    }
  }
});

test('all four edges resize independently and keep the opposite edge fixed', () => {
  const cases = [
    ['left', -40, 100, { x: 60, y: 120, width: 200, height: 200 }],
    ['right', 40, 100, { x: 100, y: 120, width: 200, height: 200 }],
    ['top', 100, -40, { x: 100, y: 80, width: 160, height: 240 }],
    ['bottom', 100, 40, { x: 100, y: 120, width: 160, height: 240 }],
  ];
  for (const [handle, dx, dy, expected] of cases) {
    assert.deepEqual({ ...resizePhotoCrop(start, handle, dx, dy, bounds, 72) }, expected, handle);
  }
});

test('all corners resize both axes without forcing a fixed aspect ratio', () => {
  for (const handle of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    const left = handle.endsWith('Left');
    const top = handle.startsWith('top');
    const result = resizePhotoCrop(start, handle, left ? -40 : 40, top ? -20 : 20, bounds, 72);
    assert.equal(result.width, 200);
    assert.equal(result.height, 220);
    assert.equal(result.x + (left ? result.width : 0), start.x + (left ? start.width : 0));
    assert.equal(result.y + (top ? result.height : 0), start.y + (top ? start.height : 0));
  }
});

test('large edge and corner drags stay inside the photo and cannot invert the frame', () => {
  for (const handle of ['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    for (const dx of [-10000, 10000]) for (const dy of [-10000, 10000]) {
      const result = resizePhotoCrop(start, handle, dx, dy, bounds, 72);
      assert.ok(result.width >= 72 && result.height >= 72, handle);
      assert.ok(result.x >= 0 && result.y >= 0, handle);
      assert.ok(result.x + result.width <= bounds.width && result.y + result.height <= bounds.height, handle);
    }
  }
});

test('moving the frame preserves its dimensions and stops at the photo boundary', () => {
  assert.deepEqual({ ...movePhotoCrop(start, -10000, 10000, bounds) }, { x: 0, y: 400, width: 160, height: 200 });
  assert.deepEqual(start, { x: 100, y: 120, width: 160, height: 200 });
});

test('initial portrait frame fits both portrait and landscape photos', () => {
  for (const size of [bounds, { width: 600, height: 200 }]) {
    const result = initialPhotoCrop(size);
    assert.equal(result.width / result.height, 0.75);
    assert.ok(result.x >= 0 && result.y >= 0);
    assert.ok(result.x + result.width <= size.width && result.y + result.height <= size.height);
  }
});

test('square thumbnail crops retain equal sides for every handle and stop at photo edges', () => {
  for (const size of [bounds, {width: 600, height: 200}, {width: 113.7, height: 202.1}]) {
    const square = initialPhotoCrop(size, 1);
    assert.equal(square.width, square.height);
    for (const handle of ['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
      for (const dx of [-10000, -30, 30, 10000]) for (const dy of [-10000, -20, 20, 10000]) {
        const result = resizePhotoCrop(square, handle, dx, dy, size, 72, 1);
        assert.equal(result.width, result.height);
        assert.ok(result.x >= -1e-9 && result.y >= -1e-9, handle);
        assert.ok(result.x + result.width <= size.width + 1e-9, handle);
        assert.ok(result.y + result.height <= size.height + 1e-9, handle);
        if (handle.endsWith('Left')) assert.ok(Math.abs(result.x + result.width - square.x - square.width) < 1e-9);
        if (handle.startsWith('top')) assert.ok(Math.abs(result.y + result.height - square.y - square.height) < 1e-9);
      }
    }
  }
});

test('square exports keep equal source-pixel dimensions after display rounding', () => {
  const square = alignPhotoCrop(initialPhotoCrop({width: 260.13, height: 462.45}, 1), 2.625);
  const result = photoCropPixels(square, {width: 260.13, height: 462.45}, {width: 1080, height: 1920}, 1);
  assert.equal(result.width, result.height);
  assert.ok(result.originX + result.width <= 1080);
  assert.ok(result.originY + result.height <= 1920);
});

test('export uses source pixels and clamps fractional frame coordinates at image edges', () => {
  assert.deepEqual({ ...photoCropPixels(start, bounds, { width: 1200, height: 1800 }) }, {
    originX: 300, originY: 360, width: 480, height: 600,
  });
  const result = photoCropPixels({ x: 100.1, y: 120.1, width: 299.9, height: 479.9 }, bounds, { width: 1201, height: 1801 });
  assert.ok(result.originX + result.width <= 1201);
  assert.ok(result.originY + result.height <= 1801);
  assert.ok(result.width > 0 && result.height > 0);
});
