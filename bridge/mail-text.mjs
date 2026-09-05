// Keep browser and device text identical using the glyphs in the embedded Geist Sans font.
function supportedGlyph(char) {
  const code = char.codePointAt(0);
  return code >= 0x20 && code <= 0x7e || code >= 0xa0 && code <= 0x17f ||
    code >= 0x2010 && code <= 0x2027 || code === 0x20ac ? char : '?';
}
const jsonBytes = text => Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;

// Bound decoded UTF-8 and escaped JSON bytes so message rows fit one USB frame.
export function mailWireText(value, maxBytes) {
  const clean = String(value ?? '').toWellFormed().replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  const text = [...clean].map(supportedGlyph).join('');
  if (jsonBytes(text) <= maxBytes) return text;
  const suffix = maxBytes >= 3 ? '\u2026' : '.'.repeat(Math.max(0, maxBytes));
  const limit = maxBytes - jsonBytes(suffix);
  let result = '', bytes = 0;
  for (const char of text) {
    const next = jsonBytes(char);
    if (bytes + next > limit) break;
    result += char; bytes += next;
  }
  return result.trimEnd() + suffix;
}
