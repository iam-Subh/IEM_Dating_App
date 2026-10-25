const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/stories/cubeMotion.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { dragCubePosition } = exported;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('taking over either side of an interrupted turn does not move the cube', () => {
  for (const origin of [0.51, 0.8, 1, 1.2, 1.49]) {
    near(dragCubePosition(1, origin, 0, 400), origin);
  }
});

test('rapid direction changes start from the rendered position', () => {
  let position = 1.8;
  position = dragCubePosition(2, position, 80, 400);
  near(position, 1.6);
  position = dragCubePosition(2, position, -120, 400);
  near(position, 1.9);
});

test('repeated touches at the first edge do not compound resistance', () => {
  let position = dragCubePosition(0, 0, 100, 400);
  near(position, -0.05);
  for (let i = 0; i < 10; i++) position = dragCubePosition(0, position, 0, 400);
  near(position, -0.05);
  near(dragCubePosition(0, position, -100, 400), 0);
});

test('crossing the first edge remains continuous in both directions', () => {
  near(dragCubePosition(0, 0.025, 10, 400), 0);
  near(dragCubePosition(0, 0.025, 11, 400), -0.0005);
  near(dragCubePosition(0, -0.005, -11, 400), 0.0025);
});
