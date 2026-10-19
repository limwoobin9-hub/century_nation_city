import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isDirectory() && ['src', 'data', 'assets'].includes(entry.name)) {
    await cp(join(root, entry.name), join(output, entry.name), { recursive: true });
  } else if (entry.isFile() && (/\.(html|css|ico|webmanifest)$/.test(entry.name) || ['service-worker.js', 'sw.js', 'manifest.json', 'robots.txt'].includes(entry.name))) {
    await cp(join(root, entry.name), join(output, entry.name));
  }
}
console.log('Static site built in dist/ (no server, database, or runtime dependencies).');
