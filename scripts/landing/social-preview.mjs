import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';
import sharp from 'sharp';

export async function buildSocialPreview(root, destination) {
  const screenshot = await sharp(path.join(root, 'docs/images/overview-light.png'))
    .resize(1240, 862, {fit:'fill', kernel:'lanczos3'})
    .png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <clipPath id="screen"><rect x="536" y="124" width="620" height="431" rx="12"/></clipPath>
      <filter id="shadow" x="-15%" y="-15%" width="130%" height="140%">
        <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#252522" flood-opacity="0.09"/>
      </filter>
    </defs>
    <rect width="1200" height="630" fill="#fafaf9"/>
    <g fill="#242423" transform="translate(64 61) scale(1.65)">
      <rect x="-1.575" y="-4.5" width="3.15" height="9" rx="1.575" transform="translate(4.8 10) rotate(-16)"/>
      <rect x="-1.575" y="-4" width="3.15" height="8" rx="1.575" transform="translate(12.7 8) rotate(-16)"/>
    </g>
    <g font-family="Geist" font-weight="400">
      <text x="108" y="86" font-size="27" letter-spacing="-0.9" fill="#242423">Companion</text>
      <text x="64" y="260" font-size="54" letter-spacing="-2.5" fill="#242423">A little screen</text>
      <text x="64" y="320" font-size="54" letter-spacing="-2.5" fill="#242423">for what matters.</text>
      <text x="64" y="376" font-size="21" fill="#6b6b66">Agent updates, AI usage</text>
      <text x="64" y="407" font-size="21" fill="#6b6b66">and everyday controls.</text>
      <text x="64" y="558" font-size="16" fill="#6b6b66">companion.victor.computer</text>
    </g>
    <rect x="536" y="124" width="620" height="431" rx="12" fill="#fff" filter="url(#shadow)"/>
    <image x="536" y="124" width="620" height="431" xlink:href="data:image/png;base64,${screenshot.toString('base64')}" clip-path="url(#screen)"/>
    <rect x="536.5" y="124.5" width="619" height="430" rx="11.5" fill="none" stroke="#deded9"/>
  </svg>`;
  const png = new Resvg(svg, {
    font: {
      fontFiles: [path.join(root, 'fonts/geist/Geist-Regular.ttf')],
      loadSystemFonts: false,
      defaultFontFamily: 'Geist',
    },
  }).render().asPng();
  await writeFile(path.join(destination, 'social-preview.png'), png);
}
