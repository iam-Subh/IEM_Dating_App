const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name, imports = {}) {
  const box = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, `../src/features/chat/${name}.ts`), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: box, exports: box.exports, require: name => { if (!(name in imports)) throw new Error(name); return imports[name]; },
  });
  return box.exports;
}
const math = load('photoEditing');
const { rotatePhoto, flipPhoto, hasPhotoEdit, photoDimensions, containPhoto, cropPixels } = math;

test('rotation and flip sequences match their visible pixel operations', () => {
  const point = { x: 2, y: 1 };
  const rotate = p => ({ x: -p.y, y: p.x });
  const flip = p => ({ x: -p.x, y: p.y });
  for (const sequence of ['rrrr', 'ff', 'rf', 'fr', 'frfr', 'rffrrf', 'ffrrrfrf']) {
    let edit, expected = point;
    for (const operation of sequence) {
      edit = operation === 'r' ? rotatePhoto(edit) : flipPhoto(edit);
      expected = operation === 'r' ? rotate(expected) : flip(expected);
    }
    let actual = point;
    for (let i = 0; i < edit.rotation / 90; i++) actual = rotate(actual);
    if (edit.flipped) actual = flip(actual);
    assert.deepEqual(actual, expected, sequence);
  }
  assert.equal(hasPhotoEdit(rotatePhoto(rotatePhoto(rotatePhoto(rotatePhoto())))), false);
  assert.equal(hasPhotoEdit(flipPhoto(flipPhoto())), false);
});

test('rotated photos fit the available area and preserve their aspect ratio', () => {
  const edit = { rotation: 90, flipped: false };
  assert.equal(photoDimensions(1200, 600, edit).width, 600);
  const fit = containPhoto(1200, 600, 300, 400, edit);
  assert.equal(fit.displayWidth, 200);
  assert.equal(fit.displayHeight, 400);
  const keyboard = containPhoto(1200, 600, 300, 180, edit);
  assert.equal(keyboard.displayHeight, 180);
  assert.equal(keyboard.displayWidth, 90);
});

test('crop selection maps to transformed pixel dimensions and stays inside the image', () => {
  const result = cropPixels({ x: 20, y: 40, width: 100, height: 180 }, 200, 400, 600, 1200);
  assert.equal(JSON.stringify(result), JSON.stringify({ originX: 60, originY: 120, width: 300, height: 540 }));
  const edge = cropPixels({ x: 199.9, y: 399.9, width: 40, height: 40 }, 200, 400, 600, 1200);
  assert.ok(edge.originX + edge.width <= 600);
  assert.ok(edge.originY + edge.height <= 1200);
  assert.ok(edge.width > 0 && edge.height > 0);
});

test('photo export applies rotate, flip and crop before one render and one save', async () => {
  const calls = [];
  const image = { saveAsync: async () => { calls.push('save'); return { uri: 'file:///prepared.png' }; }, release: () => calls.push('release image') };
  const context = { rotate: value => calls.push(`rotate ${value}`), flip: value => calls.push(`flip ${value}`), crop: () => calls.push('crop'), renderAsync: async () => { calls.push('render'); return image; }, release: () => calls.push('release context') };
  const native = load('exportPhoto', { 'expo-image-manipulator': { ImageManipulator: { manipulate: () => context }, SaveFormat: { PNG: 'png' } }, './photoEditing': math });
  const item = { id: 'one', kind: 'image', currentUri: 'file:///photo.jpg', originalUri: 'file:///photo.jpg' };
  assert.equal(await native.preparePhoto(item), item);
  assert.deepEqual(calls, []);
  await native.exportPhoto(item.currentUri, { rotation: 90, flipped: true }, { originX: 0, originY: 0, width: 100, height: 100 });
  assert.deepEqual(calls, ['rotate 90', 'flip horizontal', 'crop', 'render', 'save', 'release image', 'release context']);
  calls.length = 0;
  const result = await native.preparePhoto({ ...item, imageEdit: { rotation: 90, flipped: false } });
  assert.equal(result.currentUri, 'file:///prepared.png');
  assert.equal(result.imageEdit, undefined);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.originalUri, item.originalUri);
});
