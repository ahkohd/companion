import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { decodeFrame } from './grok-codec.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const WIDTH = 192
const HEIGHT = 168
const SAMPLE_SECONDS = 1.2
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const sha = value => createHash('sha256').update(value).digest('hex')

export function thumbnailFrame(buffer, age = SAMPLE_SECONDS) {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 24 || view.getUint32(0, true) !== 0x31435247 ||
      view.getUint16(4, true) !== WIDTH || view.getUint16(6, true) !== HEIGHT) {
    throw Error('Invalid thumbnail clip header')
  }
  const fps = view.getUint16(8, true)
  const key = view.getUint16(10, true)
  const count = view.getUint32(12, true)
  const loop = view.getUint32(16, true)
  if (fps < 1 || fps > 60 || key < 1 || key > 60 || count < 1 || count > 3600 ||
      view.getUint32(20, true) !== count || (loop !== 0xffffffff && loop >= count) ||
      data.length < 24 + (count + 2) * 4) {
    throw Error('Invalid thumbnail clip timing')
  }
  let previous = 24 + (count + 2) * 4
  for (let i = 0; i <= count + 1; i++) {
    const offset = view.getUint32(24 + i * 4, true)
    if (offset < previous || offset > data.length) throw Error('Invalid thumbnail clip offsets')
    previous = offset
  }
  if (previous !== data.length) throw Error('Invalid thumbnail clip size')

  const tick = Math.floor(Math.max(0, Number.isFinite(age) ? age : 0) * fps)
  const index = tick < count ? tick : loop === 0xffffffff ? count - 1 : loop + (tick - count) % (count - loop)
  const pixels = new Uint16Array(WIDTH * HEIGHT)
  const start = Math.floor(index / key) * key
  // A keyframe starts against black. Replay each delta after it, including skips.
  for (let i = start; i <= index; i++) {
    const from = view.getUint32(24 + i * 4, true)
    const to = view.getUint32(28 + i * 4, true)
    if (!decodeFrame(data.subarray(from, to), pixels)) throw Error('Could not decode thumbnail frame')
  }
  return { index, pixels }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length)
  name.copy(output, 4)
  data.copy(output, 8)
  let crc = 0xffffffff
  for (const byte of output.subarray(4, output.length - 4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4)
  return output
}

export function thumbnailPng(pixels) {
  if (pixels.length !== WIDTH * HEIGHT) throw Error('Invalid thumbnail pixel count')
  const rowBytes = WIDTH * 4 + 1
  const rows = Buffer.alloc(rowBytes * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const pixel = pixels[y * WIDTH + x]
      const offset = y * rowBytes + 1 + x * 4
      const r = pixel >> 11
      const g = (pixel >> 5) & 63
      const b = pixel & 31
      rows[offset] = (r << 3) | (r >> 2)
      rows[offset + 1] = (g << 2) | (g >> 4)
      rows[offset + 2] = (b << 3) | (b >> 2)
      rows[offset + 3] = pixel === 0 ? 0 : 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(WIDTH, 0)
  header.writeUInt32BE(HEIGHT, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function validDimensions(png) {
  return png.length >= 33 && png.subarray(0, 8).equals(PNG_SIGNATURE) &&
    png.toString('ascii', 12, 16) === 'IHDR' && png.readUInt32BE(16) === WIDTH && png.readUInt32BE(20) === HEIGHT
}

async function readOptional(file) {
  try { return await readFile(file) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function writeAtomic(file, bytes) {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function buildThumbnails({ check = false } = {}) {
  const [catalogBytes, manifestBytes, scriptBytes, codecBytes] = await Promise.all([
    readFile(path.join(ROOT, 'shared/grok-catalog.json')),
    readFile(path.join(ROOT, 'shared/grok-manifest.json')),
    readFile(fileURLToPath(import.meta.url)),
    readFile(path.join(ROOT, 'scripts/grok-codec.mjs')),
  ])
  const catalog = JSON.parse(catalogBytes)
  const source = JSON.parse(manifestBytes)
  const inputHash = sha(Buffer.concat([catalogBytes, manifestBytes, scriptBytes, codecBytes]))
  const directory = path.join(ROOT, 'public/thumbnails')
  const manifestPath = path.join(directory, 'manifest.json')
  let cached
  try { cached = JSON.parse(await readOptional(manifestPath)) } catch { cached = null }
  const cacheValid = cached?.version === 1 && cached.inputHash === inputHash && Array.isArray(cached.clips)
  if (check && !cacheValid) throw Error('Thumbnail cache is missing or stale. Run node scripts/build-thumbnails.mjs')
  if (!check) await mkdir(directory, { recursive: true })

  const clips = []
  let generated = 0
  for (const item of catalog) {
    if (!/^[a-z0-9-]+$/.test(item.source)) throw Error(`Invalid thumbnail source: ${item.source}`)
    const expected = source.clips.find(clip => clip.id === item.id)
    const bytes = await readFile(path.join(ROOT, `public/grok/${item.source}.bin`))
    if (!expected || sha(bytes) !== expected.sha256 || bytes.length !== expected.bytes) {
      throw Error(`Clip ${item.source} does not match its manifest. Run node scripts/ensure-grok-clips.mjs`)
    }
    const filename = `${item.source}.png`
    const file = path.join(directory, filename)
    const old = cacheValid ? cached.clips?.find(clip => clip.id === item.id && clip.file === filename) : null
    const png = old ? await readOptional(file) : null
    const valid = png && validDimensions(png) && old.sourceHash === expected.sha256 && old.bytes === png.length && sha(png) === old.sha256
    if (valid && !check) {
      clips.push(old)
      continue
    }
    const frame = thumbnailFrame(bytes)
    const output = thumbnailPng(frame.pixels)
    const record = { id: item.id, file: filename, frame: frame.index, sourceHash: expected.sha256, bytes: output.length, sha256: sha(output) }
    if (check) {
      if (!valid || !png.equals(output) || old.frame !== frame.index || old.bytes !== output.length) {
        throw Error(`Thumbnail ${filename} is missing, invalid or stale. Run node scripts/build-thumbnails.mjs`)
      }
    } else {
      await writeAtomic(file, output)
      generated++
    }
    clips.push(record)
  }
  if (check && cached.clips.length !== clips.length) throw Error('Thumbnail catalog is stale')
  if (!check && (generated || !cacheValid)) {
    await writeAtomic(manifestPath, JSON.stringify({ version: 1, inputHash, sourceHash: source.sourceHash,
      width: WIDTH, height: HEIGHT, sampleSeconds: SAMPLE_SECONDS, clips }, null, 2) + '\n')
  }
  console.log(check ? `Checked ${clips.length} thumbnails: dimensions, clip frames and PNG checksums match.` :
    `Gallery thumbnails: ${generated} generated; ${clips.length - generated} cached.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const unknown = process.argv.slice(2).filter(argument => argument !== '--check')
  if (unknown.length) throw Error(`Unknown argument: ${unknown.join(' ')}`)
  await buildThumbnails({ check: process.argv.includes('--check') })
}
