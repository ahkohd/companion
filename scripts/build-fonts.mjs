import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
for (const size of [16, 22, 28, 44]) {
  const range = size === 44 ? '0x20,0x25,0x2B,0x2D,0x30-0x39' : '0x20-0x7E,0xA0-0x17F,0x370-0x3FF,0x2010-0x2027,0x20AC'
  execFileSync(process.execPath, [
    'node_modules/lv_font_conv/lv_font_conv.js',
    '--font', 'fonts/geist/Geist-Regular.ttf',
    '--range', range,
    '--size', String(size), '--bpp', '4', '--format', 'lvgl', '--no-compress',
    '--lv-include', 'lvgl.h',
    '--lv-font-name', `lv_font_geist_${size}`,
    '--output', `firmware/main/fonts/lv_font_geist_${size}.c`,
  ], { cwd: root, stdio: 'inherit' })
}

for (const size of [22, 44, 56, 128]) {
  execFileSync(process.execPath, [
    'node_modules/lv_font_conv/lv_font_conv.js',
    '--font', 'fonts/geist/GeistPixel-Circle.ttf',
    '--range', size === 128 ? '0x20,0x2E,0x30-0x3A,0x61,0x6D,0x70' : '0x20,0x25,0x2B,0x2D-0x2E,0x30-0x3A',
    '--size', String(size), '--bpp', '4', '--format', 'lvgl', '--no-compress',
    '--lv-include', 'lvgl.h',
    '--lv-font-name', `lv_font_geist_pixel_${size}`,
    '--output', `firmware/main/fonts/lv_font_geist_pixel_${size}.c`,
  ], { cwd: root, stdio: 'inherit' })
}
