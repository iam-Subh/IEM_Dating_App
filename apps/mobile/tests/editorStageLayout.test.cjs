const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, cache = new Map()) {
  const full = path.resolve(file);
  if (cache.has(full)) return cache.get(full);
  const exported = {};
  cache.set(full, exported);
  const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, require: specifier => load(path.join(path.dirname(full), `${specifier}.ts`), cache) });
  return exported;
}
const { editorStageLayout, drawingPoint } = load(path.join(__dirname,
  '../src/features/stories/create/editor/editorStageLayout.ts'));
const { editorHasTopPanel, EDITOR_HEADER_HEIGHT, EDITOR_SHARE_HEIGHT, EDITOR_PANEL_HEIGHT, EDITOR_PREVIEW_MARGIN, EDITOR_PREVIEW_GAP } = load(path.join(__dirname,
  '../src/features/stories/create/editor/editorChromeLayout.ts'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} must match ${expected}`);

test('opening and closing Draw keeps text layout and element render dimensions fixed', () => {
  for (const screen of [[320, 568, 24, 16], [360, 800, 28, 24], [393, 852, 59, 34], [800, 1280, 24, 24]]) {
    const normal = editorStageLayout(...screen, false);
    for (const drawing of [true, false, true, false]) {
      const layout = editorStageLayout(...screen, drawing);
      assert.equal(layout.contentWidth, normal.contentWidth);
      assert.equal(layout.contentHeight, normal.contentHeight);
      assert.equal(layout.unit, normal.unit);
      close(layout.unit * layout.scale, layout.touchUnit);
      close(layout.contentWidth * layout.scale, layout.viewport.width);
      close(layout.contentHeight * layout.scale, layout.viewport.height);
    }
  }
});

test('a live stroke under the finger has the same saved position after closing Draw', () => {
  const normal = editorStageLayout(360, 800, 28, 24, false);
  const drawing = editorStageLayout(360, 800, 28, 24, true);
  for (const [x, y] of [[0, 0], [540, 960], [880, 1560], [1080, 1920]]) {
    const touchX = x * drawing.touchUnit;
    const touchY = y * drawing.touchUnit;
    const point = drawingPoint(touchX, touchY, drawing.touchUnit, drawing.unit);
    close(point.canvasX, x);
    close(point.canvasY, y);
    close(point.renderX * drawing.scale, touchX);
    close(point.renderY * drawing.scale, touchY);
    close(point.renderX, point.canvasX * normal.unit);
    close(point.renderY, point.canvasY * normal.unit);
  }
});

test('brush width scales with the picture and keeps its saved canvas size', () => {
  const drawing = editorStageLayout(393, 852, 59, 34, true);
  for (const brushWidth of [6, 14, 40, 120]) {
    close(brushWidth * drawing.unit * drawing.scale, brushWidth * drawing.touchUnit);
  }
});

test('overlay controls leave the picture at its full available size and centered', () => {
  for (const [width, height, top, bottom] of [[320, 568, 24, 16], [360, 800, 28, 24], [393, 852, 59, 34], [800, 1280, 24, 24]]) {
    for (const expandedPanel of [false, true]) {
      const { viewport } = editorStageLayout(width, height, top, bottom, false, expandedPanel);
      const pictureTop = top + EDITOR_HEADER_HEIGHT + (expandedPanel ? EDITOR_PANEL_HEIGHT : 0) + EDITOR_PREVIEW_GAP;
      const pictureBottom = height - bottom - EDITOR_SHARE_HEIGHT - EDITOR_PREVIEW_GAP;
      assert.ok(viewport.top >= pictureTop);
      assert.ok(viewport.top + viewport.height <= pictureBottom + 0.0001);
      assert.ok(viewport.left >= EDITOR_PREVIEW_MARGIN);
      assert.ok(viewport.left + viewport.width <= width - EDITOR_PREVIEW_MARGIN + 0.0001);
      close(viewport.width, Math.min(width - EDITOR_PREVIEW_MARGIN * 2, (pictureBottom - pictureTop) * 9 / 16));
      close(viewport.left + viewport.width / 2, width / 2);
      close(viewport.top + viewport.height / 2, (pictureTop + pictureBottom) / 2);
      close(viewport.width / viewport.height, 9 / 16);
    }
  }
});

test('opening a tool panel preserves element geometry and canvas touch positions', () => {
  const normal = editorStageLayout(360, 800, 28, 24, false);
  for (const expandedPanel of [true, false, true, false]) {
    const layout = editorStageLayout(360, 800, 28, 24, false, expandedPanel);
    assert.equal(layout.contentWidth, normal.contentWidth);
    assert.equal(layout.contentHeight, normal.contentHeight);
    assert.equal(layout.unit, normal.unit);
    for (const [x, y] of [[0, 0], [540, 960], [880, 1560], [1080, 1920]]) {
      const point = drawingPoint(x * layout.touchUnit, y * layout.touchUnit, layout.touchUnit, layout.unit);
      close(point.canvasX, x);
      close(point.canvasY, y);
      close(point.renderX, x * normal.unit);
      close(point.renderY, y * normal.unit);
    }
  }
});

test('text controls, timer and effects keep the photo size and position unchanged', () => {
  for (const screen of [[320, 568, 24, 16], [360, 800, 28, 24], [393, 852, 59, 34]]) {
    const closed = editorStageLayout(...screen, false, editorHasTopPanel('none'));
    for (const tool of ['text', 'duration', 'effects']) {
      const open = editorStageLayout(...screen, false, editorHasTopPanel(tool));
      assert.deepEqual(open, closed);
    }
  }
});

test('compact text controls fit below the full photo when the keyboard is closed', () => {
  for (const screen of [[320, 568, 24, 16], [360, 800, 28, 24], [393, 852, 59, 34]]) {
    const { viewport } = editorStageLayout(...screen, false);
    const controlsTop = screen[1] - screen[3] - 68;
    assert.ok(controlsTop > viewport.top + viewport.height);
  }
});
