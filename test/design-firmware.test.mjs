import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import schema from '../shared/design-schema.json' with { type: 'json' }

const cjson = '.tools/esp-idf/components/json/cJSON'
const available = existsSync(path.join(cjson, 'cJSON.c'))
const needsIdf = { skip: !available && 'Run firmware:setup for the cJSON dependency' }
let directory, probe, frameProbe
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'native-design-'))
  probe = path.join(directory, 'probe')
  if (available) execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main', '-I', cjson,
    'test/design-probe.c', 'firmware/main/display_module.c', path.join(cjson, 'cJSON.c'), '-lm', '-o', probe])
  if (available) {
    // Compile the production frame parser without hardware or rendering dependencies.
    const source = readFileSync('firmware/main/main.c', 'utf8')
    const type = source.slice(source.indexOf('typedef struct {'), source.indexOf('static SemaphoreHandle_t'))
    const functions = source.slice(source.indexOf('static bool json_uint('), source.indexOf('static bool name_shimmer_enabled('))
      .replace(/static int status_top_for_gap\([^]*?\n}\n/, '')
    const definitions = source.match(/^#define (?:FRAME_MAX|FACE_LABEL_CAPACITY|FACE_NAME_CAPACITY|TEXT_GAP_DEFAULT) .*$/gm).join('\n')
    const code = `#include <math.h>\n#include <stdio.h>\n#include <string.h>\n#include "face_model.h"\n#include "display_module.h"\n#include "attention_protocol.h"\n${definitions}\n${type}\n${functions}\nint main(void) { char line[8192]; while(fgets(line,sizeof(line),stdin)) { status_snapshot_t frame={0}; size_t length=strlen(line); if(length&&line[length-1]=='\\n') line[--length]=0; puts(parse_state_frame(line,length,&frame)?"true":"false"); } }\n`
    const sourcePath = path.join(directory, 'frames.c'); frameProbe = path.join(directory, 'frames')
    await writeFile(sourcePath, code)
    execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main', '-I', cjson,
      sourcePath, 'firmware/main/display_module.c', 'firmware/main/attention_protocol.c', path.join(cjson, 'cJSON.c'), '-lm', '-o', frameProbe])
  }
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
const parse = frames => execFileSync(probe, [], { input: frames.map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse)
const defaults = module => schema[module].map(field => field.default)

test('native design schema matches the shared schema and omitted arrays use exact defaults', needsIdf, () => {
  execFileSync(process.execPath, ['scripts/build-design-schema.mjs', '--check'])
  const modules = Object.keys(schema)
  assert.deepEqual(parse(modules.map(module => ({ module }))), modules.map(module => ({ module, values: defaults(module) })))
  assert.deepEqual(parse([{}])[0], { module: 'face', values: defaults('face') })
  assert.deepEqual(parse([{ module: 'face', design: defaults('face').slice(0, 8) }])[0], { module: 'face', values: defaults('face') })
  const legacyUsage = defaults('usage').slice(0, 25)
  legacyUsage[schema.usage.findIndex(field => field.key === 'barHeight')] = 20
  assert.deepEqual(parse([{ module: 'usage', design: legacyUsage }])[0], { module: 'usage', values: [...legacyUsage, ...defaults('usage').slice(25)] })
  const legacyRoon = defaults('roon').slice(0, 13)
  legacyRoon[schema.roon.findIndex(field => field.key === 'controlSize')] = 28
  assert.deepEqual(parse([{ module: 'roon', design: legacyRoon }])[0], { module: 'roon', values: [...legacyRoon, 0, 0] })
})

test('every design option and range boundary reaches native fields in the shared order', needsIdf, () => {
  const frames = [], expected = []
  for (const [module, fields] of Object.entries(schema)) fields.forEach((field, index) => {
    for (const value of [...(field.options || [field.min, field.max]), ...(field.allowAuto ? [0] : [])]) {
      const values = defaults(module); values[index] = value
      frames.push({ module, design: values }); expected.push({ module, values })
    }
  })
  assert.deepEqual(parse(frames), expected)
})

test('native rejects partial arrays, invalid numeric fields and unsupported options', needsIdf, () => {
  const frames = []
  for (const [module, fields] of Object.entries(schema)) {
    for (const design of [null, {}, true, 4, 'default', [], defaults(module).slice(1), [...defaults(module), 0]]) frames.push({ module, design })
    fields.forEach((field, index) => {
      const invalid = [null, true, '16', {}, [], field.min - 1, field.max + 1, field.default + .5]
      if (field.options) invalid.push(...[...Array(field.max + 1).keys()].filter(value => !field.options.includes(value)).slice(0, 2))
      for (const value of invalid) { const design = defaults(module); design[index] = value; frames.push({ module, design }) }
    })
  }
  assert.deepEqual(parse(frames), frames.map(() => null))
})

test('production state parser accepts 4096-byte designer frames and rejects overflow', needsIdf, () => {
  const frame = { type: 'state', v: 1, seq: 4, state: 'working', label: 'Working', name: 'Session',
    counts: { working: 1, blocked: 0, done: 0, idle: 0, unknown: 0 }, design: defaults('face'), padding: '' }
  const base = JSON.stringify(frame).length
  const inputs = [2048, 2049, 4096, 4097].map(bytes => JSON.stringify({ ...frame, padding: 'x'.repeat(bytes - base) }))
  const results = execFileSync(frameProbe, [], { input: inputs.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse)
  assert.deepEqual(results, [true, true, true, false])
})

test('production state parser rejects removed clips and accepts native overrides', needsIdf, () => {
  const frame = { type: 'state', v: 1, seq: 7, state: 'working', label: 'Working', name: 'Session',
    counts: { working: 1, blocked: 0, done: 0, idle: 0, unknown: 0 } };
  const valid = [frame, { ...frame, animation: null }, ...['working', 'blocked', 'done', 'idle', 'sleep', 'unknown', 'disconnected'].map(expression => ({ ...frame, expression }))];
  const invalid = ['grok:happy', 'grok:celebrate', 'done', '', true, 1, [], {}].map(animation => ({ ...frame, animation }));
  const result = execFileSync(frameProbe, [], { input: [...valid, ...invalid].map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  assert.deepEqual(result, [...valid.map(() => true), ...invalid.map(() => false)]);
});

test('production state parser accepts every integer rotation and retains legacy frames', needsIdf, () => {
  const frame = { type: 'state', v: 1, seq: 7, state: 'idle', label: 'Idle', name: '',
    counts: { working: 0, blocked: 0, done: 0, idle: 0, unknown: 0 } }
  const valid = [frame, ...Array.from({ length: 360 }, (_, rotation) => ({ ...frame, rotation }))]
  const invalid = [-90, -1, 360, 0.5, 180.5, true, null, '90', {}, []].map(rotation => ({ ...frame, rotation }))
  const results = execFileSync(frameProbe, [], { input: [...valid, ...invalid].map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse)
  assert.deepEqual(results, [...valid.map(() => true), ...invalid.map(() => false)])
})


test('production attention parser validates bounded actions and descriptions', needsIdf, () => {
  const frame = { type: 'state', v: 1, seq: 7, state: 'done', label: 'Review', name: 'Tap for details',
    counts: { working: 0, blocked: 0, done: 1, idle: 0, unknown: 0 } }
  const attention = { id: '12345678-abcd-1234-abcd-123456789012', revision: 1, detail: true, body: 'x'.repeat(480),
    actions: [{ id: 'approve', label: 'Approve' }, { id: 'cancel', label: 'Cancel' }] }
  const cases = [undefined, attention, { ...attention, detail: false }, { ...attention, body: 'x'.repeat(481) },
    { ...attention, revision: -1 }, { ...attention, revision: 1.5 }, { ...attention, actions: [] },
    { ...attention, actions: [{ id: 'open', label: 'Open' }] },
    { ...attention, actions: [{ id: '__dismiss', label: 'Dismiss' }] },
    { ...attention, actions: [{ id: 'bad"token', label: 'Bad' }] },
    { ...attention, actions: [{ id: 'ok', label: 'x'.repeat(17) }] },
    { ...attention, actions: [attention.actions[0], attention.actions[0]] }]
  const result = execFileSync(frameProbe, [], { input: cases.map(attention => JSON.stringify({ ...frame, attention })).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse)
  assert.deepEqual(result, [true, true, true, false, false, false, false, false, false, false, false, false])
})


test('attention double tap never emits first approval and cancels stale gestures', needsIdf, () => {
  const gestureProbe = path.join(directory, 'attention-gesture')
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main', '-I', cjson,
    'test/attention-gesture-probe.c', 'firmware/main/attention_gesture.c', '-o', gestureProbe])
  execFileSync(gestureProbe)
})


test('production frame boundary rejects escaped NUL before cJSON can truncate identifiers', needsIdf, () => {
  const frame = {type:'state',v:1,seq:7,state:'idle',label:'Idle',name:'',counts:{working:0,blocked:0,done:0,idle:0,unknown:0}};
  const frames = [{...frame,name:'safe\u0000hidden'},{...frame,name:'safe\\u0000'}];
  const results=execFileSync(frameProbe,[],{input:frames.map(JSON.stringify).join('\n')+'\n',encoding:'utf8'}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(results,[false,true]);
});
