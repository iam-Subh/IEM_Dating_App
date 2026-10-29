const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/components/profile-detail/photoLightboxGeometry.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, {exports: exported});
const {fitLightboxPhoto, lightboxTransform} = exported;
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test('portrait and landscape photos fit inside the safe viewport', () => {
  for (const source of [{width: 900, height: 1600}, {width: 1600, height: 900}]) {
    const frame = fitLightboxPhoto(source, 360, 800, 30, 24);
    assert.ok(frame.x >= 0 && frame.y >= 30);
    assert.ok(frame.x + frame.width <= 360 && frame.y + frame.height <= 776);
    near(frame.width / frame.height, source.width / source.height);
  }
});

test('the lightbox starts exactly at the tapped photo and ends at the fitted image', () => {
  const origin = {x: 16, y: 300, width: 328, height: 437};
  const target = fitLightboxPhoto({width: 900, height: 1600}, 360, 800, 30, 24);
  for (const [progress, frame] of [[0, origin], [1, target]]) {
    const motion = lightboxTransform(origin, target, target, progress);
    near(target.width * motion.scaleX, frame.width);
    near(target.height * motion.scaleY, frame.height);
    near(target.x + target.width / 2 + motion.translateX, frame.x + frame.width / 2);
    near(target.y + target.height / 2 + motion.translateY, frame.y + frame.height / 2);
  }
});

test('the photo keeps its ratio throughout the transition', () => {
  const origin = {x: 16, y: -50, width: 328, height: 437};
  const target = fitLightboxPhoto({width: 1600, height: 900}, 360, 800, 30, 24);
  for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
    const motion = lightboxTransform(origin, target, target, progress);
    near(motion.scaleX * motion.imageScaleX, motion.scaleY * motion.imageScaleY);
    assert.ok(Number.isFinite(motion.radius));
  }
});

test('closing can start from the zoomed image without resetting its position', () => {
  const origin = {x: 16, y: 300, width: 328, height: 437};
  const base = {x: 0, y: 100, width: 360, height: 600};
  const zoomed = {x: -250, y: -390, width: 900, height: 1500};
  const motion = lightboxTransform(origin, zoomed, base, 1);
  near(motion.scaleX, 2.5);
  near(motion.scaleY, 2.5);
  near(base.x + base.width / 2 + motion.translateX, zoomed.x + zoomed.width / 2);
  near(base.y + base.height / 2 + motion.translateY, zoomed.y + zoomed.height / 2);
});
