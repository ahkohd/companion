import { copyFile, mkdir } from 'node:fs/promises';

// The picker uses the bundled English metadata without a CDN connection.
await mkdir(new URL('../public/emoji-data/en/', import.meta.url), { recursive: true });
for (const name of ['data.json', 'messages.json']) {
  await copyFile(new URL(`../node_modules/emojibase-data/en/${name}`, import.meta.url), new URL(`../public/emoji-data/en/${name}`, import.meta.url));
}
await copyFile(new URL('../node_modules/emojibase-data/LICENSE', import.meta.url), new URL('../public/emoji-data/LICENSE', import.meta.url));
await copyFile(new URL('../node_modules/frimousse/LICENSE', import.meta.url), new URL('../public/emoji-data/Frimousse-LICENSE', import.meta.url));
