import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTextGap } from './store.mjs';

export class DisplaySettings {
  pending = Promise.resolve();
  constructor(store, { filePath = fileURLToPath(new URL('../.cache/display-settings.json', import.meta.url)) } = {}) {
    this.store = store; this.filePath = filePath;
  }
  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.store.setTextGap(value?.textGap);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load text spacing; using the default.');
    }
  }
  save(textGap) {
    validateTextGap(textGap);
    const operation = this.pending.then(async () => {
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify({ textGap }) + '\n');
        await rename(temporary, this.filePath);
        this.store.setTextGap(textGap);
      } finally { await rm(temporary, { force: true }); }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
