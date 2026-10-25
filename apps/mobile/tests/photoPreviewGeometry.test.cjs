const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/photoPreviewGeometry.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: exported});
const {fitPreviewPhoto, clampPreviewPan, previewZoomAtPoint} = exported;
const viewport = {width: 360, height: 640};

test('portrait, landscape, and square photos fit without cropping or distortion', () => {
  for (const source of [{width: 2000, height: 2000}, {width: 1080, height: 1920}, {width: 1920, height: 1080}]) {
    const fit = fitPreviewPhoto(source, viewport);
    assert.ok(fit.width <= viewport.width && fit.height <= viewport.height);
    assert.ok(Math.abs(fit.width / fit.height - source.width / source.height) < 1e-9);
    assert.ok(fit.width === viewport.width || fit.height === viewport.height);
  }
});

test('panning centres smaller axes and prevents moving a zoomed photo off screen', () => {
  const image = {width: 360, height: 360};
  assert.deepEqual({...clampPreviewPan(9999, -9999, 1, image, viewport)}, {x: 0, y: 0});
  assert.deepEqual({...clampPreviewPan(9999, -9999, 3, image, viewport)}, {x: 360, y: -220});
});

test('zoom keeps the touched point fixed and limits scale to 1 through 5', () => {
  const image = {width: 360, height: 640};
  const zoom = previewZoomAtPoint(1, 2, 0, 0, 70, -90, image, viewport);
  assert.deepEqual({...zoom}, {scale: 2, x: -70, y: 90});
  assert.equal((70 - zoom.x) / zoom.scale, 70);
  assert.equal((-90 - zoom.y) / zoom.scale, -90);
  assert.deepEqual({...previewZoomAtPoint(2, 0.5, zoom.x, zoom.y, 0, 0, image, viewport)}, {scale: 1, x: 0, y: 0});
  assert.equal(previewZoomAtPoint(1, 100, 0, 0, 0, 0, image, viewport).scale, 5);
});
