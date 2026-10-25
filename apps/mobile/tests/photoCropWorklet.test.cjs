const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

test('compiled crop resize captures an initialized UI worklet for fixed proportions', () => {
  const mobile = path.resolve(__dirname, '..');
  const {code} = babel.transformFileSync(path.join(mobile, 'src/screens/main/profile/photoCropGeometry.ts'), {
    cwd: mobile,
    configFile: path.join(mobile, 'babel.config.js'),
  });
  const exports = {};
  vm.runInNewContext(code, {exports, global: {Error}});
  const resize = exports.resizePhotoCrop;
  assert.equal(typeof resize.__closure.resizeFixedPhotoCrop, 'function');
  assert.equal(typeof resize.__closure.resizeFixedPhotoCrop.__workletHash, 'number');
  // Run the function serialized for the UI runtime, with its captured closure.
  const uiResize = vm.runInNewContext(`(${resize.__initData.code})`);
  const result = uiResize.call(resize,
    {x: 100, y: 120, width: 160, height: 160}, 'bottomRight', 40, 40,
    {width: 400, height: 600}, 72, 1);
  assert.equal(result.width, 200);
  assert.equal(result.height, 200);
  assert.equal(result.x, 100);
  assert.equal(result.y, 120);
});

test('UI crop edges resize independently from a square and export the chosen rectangle', () => {
  const mobile = path.resolve(__dirname, '..');
  const {code} = babel.transformFileSync(path.join(mobile, 'src/screens/main/profile/photoCropGeometry.ts'), {
    cwd: mobile,
    configFile: path.join(mobile, 'babel.config.js'),
  });
  const exports = {};
  vm.runInNewContext(code, {exports, global: {Error}});
  const resize = exports.resizePhotoCrop;
  const uiResize = vm.runInNewContext(`(${resize.__initData.code})`);
  const start = {x: 100, y: 120, width: 160, height: 160};
  const bounds = {width: 400, height: 600};
  const cases = [
    ['left', -40, 40, {x: 60, y: 120, width: 200, height: 160}],
    ['right', 40, 40, {x: 100, y: 120, width: 200, height: 160}],
    ['top', 40, -40, {x: 100, y: 80, width: 160, height: 200}],
    ['bottom', 40, 40, {x: 100, y: 120, width: 160, height: 200}],
  ];
  for (const [handle, dx, dy, expected] of cases) {
    const crop = uiResize.call(resize, start, handle, dx, dy, bounds, 72);
    assert.deepEqual({...crop}, expected);
    const pixels = exports.photoCropPixels(crop, bounds, {width: 1200, height: 1800});
    assert.equal(pixels.width, crop.width * 3);
    assert.equal(pixels.height, crop.height * 3);
  }
});
