import {chromium} from 'playwright';
import {mkdir, mkdtemp, writeFile, rename, copyFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CAPTURE_TIME, showcaseSnapshot} from './fixture.mjs';
import {startScreenshotServer} from './server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'docs/images');
await mkdir(output, {recursive:true});
const temporary = await mkdtemp(path.join(output, '.capture-'));
const cases = [
  {name:'overview',heading:'Overview',module:'face'},
  {name:'designer',heading:'Designer',module:'face'},
  {name:'modules',heading:'Modules',module:'usage'},
  {name:'animations',heading:'Animations',module:'face'},
];
let browser, preview;
const manifest = {viewport:{width:1440,height:1000},deviceScaleFactor:2,themes:['light','dark'],sampleTime:new Date(CAPTURE_TIME).toISOString(),screenshots:[]};
try {
  await mkdir(temporary, {recursive:true});
  browser = await chromium.launch();
  for (const theme of manifest.themes) {
    preview = await startScreenshotServer({theme});
    const origin = preview.url;
    const context = await browser.newContext({viewport:manifest.viewport, deviceScaleFactor:manifest.deviceScaleFactor, colorScheme:theme, reducedMotion:'reduce', locale:'en-GB', timezoneId:'Europe/London', serviceWorkers:'block'});
    context.setDefaultTimeout(15_000);
    const errors = [];
    // Nothing from the capture can contact the live bridge or an external service.
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) {
        errors.push(`Unexpected external request: ${route.request().url()}`);
        return route.abort();
      }
      return route.continue();
    });
    for (const shot of cases) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {if(response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);});
      await page.clock.setFixedTime(new Date(CAPTURE_TIME));
      await page.goto(`${origin}/?module=${shot.module}#${shot.name}`);
      await page.getByRole('heading', {name:shot.heading, exact:true, level:1}).waitFor();
      await page.locator('.topbar-status').getByText('Connected', {exact:true}).waitFor();
      await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === (expected === 'dark'), theme);
      const background = showcaseSnapshot(shot.module, theme).deviceAppearance.palette.background;
      await page.waitForFunction(expected => {
        const screen = document.querySelector('.device-screen');
        const color = document.createElement('div');
        color.style.backgroundColor = expected;
        return screen && getComputedStyle(screen).backgroundColor === color.style.backgroundColor;
      }, `#${background.toString(16).padStart(6, '0')}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const image of document.images) image.loading = 'eager';
        await Promise.all([...document.images].map(image => image.decode()));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      // Capture the animation library rather than the mappings editor.
      if (shot.name === 'animations') {
        await page.getByRole('button', {name:/Animation library/}).click();
        await page.evaluate(async () => {
          for (const image of document.images) image.loading = 'eager';
          await Promise.all([...document.images].map(image => image.decode()));
        });
      }
      if (errors.length) throw Error(errors.join('\n'));
      const filename = `${shot.name}-${theme}.png`;
      const buffer = await page.screenshot({path:path.join(temporary, filename), animations:'disabled', caret:'hide', scale:'device'});
      const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
      if (width !== 2880 || height !== 2000) throw Error(`${filename}: expected a native 2880 x 2000 capture.`);
      manifest.screenshots.push({name:shot.name,theme,deviceTheme:theme,filename,width,height,sha256:createHash('sha256').update(buffer).digest('hex')});
      console.log(`Captured ${shot.name} / ${theme} (${width} x ${height})`);
      await page.close();
    }
    await context.close();
    await preview.close();
    preview = null;
  }
  // Replace the published set only after every screen rendered successfully.
  for (const shot of manifest.screenshots) await rename(path.join(temporary, shot.filename), path.join(output, shot.filename));
  // Keep existing README image URLs working.
  for (const shot of cases) await copyFile(path.join(output, `${shot.name}-dark.png`), path.join(output, `${shot.name}.png`));
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally {
  await browser?.close();
  await preview?.close();
  await rm(temporary, {recursive:true,force:true});
}
