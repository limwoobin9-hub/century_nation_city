import { readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.cache', 'dist'].includes(entry.name)) continue;
    const file = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(file);
  }
  return files;
}
const files = await walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const file of ['index.html', 'src/main.js', 'src/core/game.js', 'src/render/renderer.js', 'src/render/sprites.js', 'src/save/storage.js']) {
  await access(join(root, file));
}
console.log(`Checked ${files.length} JavaScript files and required application entry points.`);
