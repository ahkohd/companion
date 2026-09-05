import { Resvg } from '@resvg/resvg-js';

export const WIDTH = 192, HEIGHT = 168;
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const cssName = key => key.replace(/[A-Z]/g, ch => '-'+ch.toLowerCase());
function colorVars(value) {
  return String(value).replace(/var\(--fg\)/g, '#b8a4ed').replace(/var\(--bg\)/g, '#000000').replace(/var\(--gb-badge,\s*#[\da-f]+\)/gi, '#5b95f0');
}
export function svgNode(node) {
  if (node == null || node === false) return '';
  if (typeof node !== 'object') return escape(node);
  const tag = node.tag;
  if (!tag) throw new Error('Missing SVG tag');
  const attrs = Object.entries(node.attributes ?? {}).filter(([k,v]) => v != null && !['xmlns','style','width','height'].includes(k) || (v != null && ['width','height'].includes(k) && tag !== 'svg'));
  const style = Object.entries(node.style ?? {}).filter(([,v]) => v != null && v !== '').map(([k,v]) => `${cssName(k)}:${colorVars(v)}`).join(';');
  return `<${tag}${attrs.map(([k,v]) => ` ${k === 'clipPath' ? 'clip-path' : k}="${escape(colorVars(v))}"`).join('')}${style ? ` style="${escape(style)}"` : ''}>${(node.children ?? []).map(svgNode).join('')}</${tag}>`;
}
export function captureSvg(tree) {
  // Preserve original geometry, clipping and paint order. Fit the body above the labels.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="-100 -100 200 175"><rect x="-100" y="-100" width="200" height="175" fill="black"/><g transform="translate(-74.275825 -84.275825) scale(.65)">${tree.children.map(svgNode).join('')}</g></svg>`;
}
export function rasterSnapshot(tree) {
  const image = new Resvg(captureSvg(tree), {font:{loadSystemFonts:false},background:'#000000'}).render();
  const rgba = image.pixels, pixels = new Uint16Array(WIDTH*HEIGHT);
  for(let i=0;i<pixels.length;i++) pixels[i]=((rgba[i*4]>>3)<<11)|((rgba[i*4+1]>>2)<<5)|(rgba[i*4+2]>>3);
  return pixels;
}
