const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'docs/design-review/chat-lab');
const out = path.join(source, 'dist');
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(source, 'client.ts')], bundle: true, minify: true, platform: 'browser', target: 'es2022', outfile: path.join(out, 'app.js') });
for (const file of ['index.html', 'style.css']) fs.copyFileSync(path.join(source, file), path.join(out, file));
for (const weight of ['400Regular', '500Medium', '700Bold']) {
  const file = `DMSans_${weight}.ttf`;
  fs.copyFileSync(path.join(root, 'docs/design-review/reminders', file), path.join(out, 'assets', file));
}
console.log('Built localhost Chat Lab.');
