import { mkdir, symlink, readlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const links = [
  [path.join(root, 'scripts/companion.mjs'), path.join(homedir(), '.local/bin/companion')],
  [path.join(root, 'skills/companion-attention'), path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'skills/companion-attention')],
];
await chmod(links[0][0], 0o755);
for (const [source, target] of links) {
  await mkdir(path.dirname(target), { recursive: true });
  try { await symlink(source, target); }
  catch (error) { if (error.code !== 'EEXIST' || await readlink(target).catch(() => '') !== source) throw new Error(`Cannot install over existing file: ${target}`); }
  console.log(`Installed ${target}`);
}
console.log('Keep this checkout in place. Add ~/.local/bin to PATH if needed.');
