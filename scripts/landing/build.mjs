import {mkdir, mkdtemp, readFile, readdir, writeFile, cp, rename, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {buildSocialPreview} from './social-preview.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'landing-dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.COMPANION_VERSION || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Use a released version, such as 0.2.9.');
const download = `https://cdn.victor.computer/companion/arm64/Companion-${version}-arm64.dmg`;
const cache = path.join(root, '.cache');
await mkdir(cache, {recursive:true});
const staging = await mkdtemp(path.join(cache, 'landing-build-'));

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

try {
  await mkdir(path.join(staging, 'screenshots'), {recursive:true});
  await mkdir(path.join(staging, 'fonts'), {recursive:true});
  const html = (await readFile(path.join(root, 'landing/index.html'), 'utf8'))
    .replaceAll('{{VERSION}}', version).replaceAll('{{DOWNLOAD_URL}}', download);
  await writeFile(path.join(staging, 'index.html'), html);
  for (const name of ['styles.css','app.js','robots.txt','sitemap.xml']) {
    await cp(path.join(root, 'landing', name), path.join(staging, name));
  }
  await cp(path.join(root, 'public/favicon.svg'), path.join(staging, 'favicon.svg'));
  await cp(path.join(root, 'public/fonts/Geist-Variable.woff2'), path.join(staging, 'fonts/Geist-Variable.woff2'));
  await cp(path.join(root, 'fonts/geist/OFL.txt'), path.join(staging, 'fonts/OFL.txt'));
  for (const name of ['overview','designer','modules','animations']) {
    for (const theme of ['light','dark']) {
      const source = path.join(root, `docs/images/${name}-${theme}.png`);
      const {width,height} = await sharp(source).metadata();
      if (width !== 2880 || height !== 2000) throw Error(`Recapture ${name}-${theme} at 2x resolution with pnpm screenshots.`);
      await sharp(source).webp({lossless:true,effort:6}).toFile(path.join(staging, `screenshots/${name}-${theme}.webp`));
    }
  }
  await buildSocialPreview(root, staging);

  // Prepare every replacement before touching the served output. Publish HTML last.
  const assets = (await listFiles(staging)).filter(name => name !== 'index.html').sort();
  for (const name of [...assets, 'index.html']) {
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), {recursive:true});
    await rename(path.join(staging, name), target);
  }
} finally {
  await rm(staging, {recursive:true,force:true});
}
console.log(`Built landing-dist for Companion ${version}. Preview with pnpm landing:preview.`);
