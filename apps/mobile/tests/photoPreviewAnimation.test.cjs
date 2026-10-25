const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, imports) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/features/chat', relativePath), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  } });
  return module.exports;
}

const math = load('photoEditing.ts', {});
const jsx = (type, props) => ({ type, props });
const { PhotoEditPreview } = load('components/PhotoEditPreview.tsx', {
  react: { useEffect: fn => fn(), useState: value => [value, () => {}] },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { Image: { getSize: () => { throw new Error('Unexpected image reload'); } }, StyleSheet: { create: value => value } },
  'react-native-reanimated': { __esModule: true, default: { View: 'View', Image: 'Image' }, useAnimatedStyle: read => ({ read }), useSharedValue: value => ({ value }), withTiming: value => value },
  '../photoEditing': math,
});
const style = items => Object.assign({}, ...items.map(item => item.read ? item.read() : item));

test('the mounted photo stays centered and fits during keyboard opening, reversal and closing', () => {
  for (const naturalSize of [{ width: 1080, height: 2412 }, { width: 2400, height: 1200 }]) {
    for (const rotation of [0, 90, 180, 270]) {
      const viewportHeight = { value: 600 };
      const tree = PhotoEditPreview({ uri: 'file:///photo.jpg', width: 360, height: 360, naturalSize, edit: { rotation, flipped: true }, viewportHeight });
      const image = tree.props.children;
      // Read the same mounted view's animated styles at each frame.
      for (const height of [600, 520, 400, 280, 320, 400, 520, 600, 0]) {
        viewportHeight.value = height;
        const frame = style(tree.props.style);
        const rendered = style(image.props.style);
        const scale = rendered.transform[0].scale;
        const sideways = rotation % 180 === 90;
        const displayWidth = (sideways ? rendered.height : rendered.width) * scale;
        const displayHeight = (sideways ? rendered.width : rendered.height) * scale;
        assert.equal(frame.height, height);
        assert.ok(displayWidth <= 360 + 1e-7);
        assert.ok(displayHeight <= height + 1e-7);
        assert.ok(Math.abs(rendered.left + rendered.width / 2 - 180) < 1e-7);
        assert.ok(Math.abs(rendered.top + rendered.height / 2 - height / 2) < 1e-7);
        if (height > 0) assert.ok(Math.abs(displayWidth / displayHeight - (sideways ? naturalSize.height / naturalSize.width : naturalSize.width / naturalSize.height)) < 1e-7);
        assert.equal(image.props.source.uri, 'file:///photo.jpg');
      }
    }
  }
});

test('crop and thumbnail previews retain their fixed frame without keyboard animation', () => {
  const tree = PhotoEditPreview({ uri: 'file:///photo.jpg', width: 52, height: 58, naturalSize: { width: 1200, height: 600 } });
  const frame = style(tree.props.style);
  const image = style(tree.props.children.props.style);
  assert.equal(frame.height, 58);
  assert.equal(image.width, 52);
  assert.equal(image.height, 26);
  assert.equal(image.top, 16);
  assert.equal(image.transform[0].scale, 1);
});
