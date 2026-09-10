import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const cjson = '.tools/esp-idf/components/json/cJSON';
const parserAvailable = existsSync(path.join(cjson, 'cJSON.c'));
let directory, parser, touch;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'display-modules-'));
  touch = path.join(directory, 'touch');
  const flags = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main'];
  execFileSync('cc', [...flags, 'test/module-touch-probe.c', 'firmware/main/module_touch.c', '-o', touch]);
  if (parserAvailable) {
    parser = path.join(directory, 'parser');
    execFileSync('cc', [...flags, '-I', cjson, 'test/module-probe.c', 'firmware/main/display_module.c', path.join(cjson, 'cJSON.c'), '-lm', '-o', parser]);
  }
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
function parse(...frames) {
  return execFileSync(parser, [], { input: frames.map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
}
const needsIdf = { skip: !parserAvailable && 'Run firmware:setup to provide the firmware cJSON dependency' };

test('device touch distinguishes module and usage page swipes with one action per contact', () => {
  assert.match(execFileSync(touch, [], { encoding: 'utf8' }), /touch checks passed/);
});
test('module protocol retains legacy defaults and distinguishes missing values from zero', needsIdf, () => {
  const [legacy, absent, zero, partial] = parse({},
    { module: 'usage', dashboard: { status: 'ready', primary: { remaining: null } } },
    { module: 'usage', moduleIndex: 1, moduleCount: 3, dashboard: { status: 'ready', primary: { remaining: 0 }, secondary: { remaining: 100 } } },
    { module: 'hey', dashboard: { status: 'ready', count: 100, countMore: true, boxes: [{ label: 'Imbox', count: 0 }, { label: 'Feed', count: null }] } });
  assert.equal(legacy.kind, 0); assert.equal(legacy.modules, 1); assert.equal(legacy.status, 2);
  assert.equal(legacy.pageIndex, 0); assert.equal(legacy.pageCount, 1);
  assert.equal(absent.primary, false); assert.equal(zero.primary, true); assert.equal(zero.remaining, 0);
  assert.equal(zero.index, 1); assert.equal(zero.modules, 3);
  assert.equal(partial.hasCount, true); assert.equal(partial.count, 100); assert.equal(partial.countMore, true);
  assert.deepEqual(partial.boxAvailable, [true, false, false]);
});
test('module parser rejects invalid kinds, positions and truncated or oversized metric data', needsIdf, () => {
  const invalid = [
    { module: 'calendar' }, { module: null }, { moduleIndex: 1 }, { moduleCount: 2 },
    { moduleIndex: 3, moduleCount: 3 }, { moduleIndex: 0, moduleCount: 0 }, { moduleIndex: 0, moduleCount: 8 },
    { moduleIndex: 0.5, moduleCount: 2 }, { dashboard: null },
    ...[null, 'true', 1, []].map(showModuleNavigation => ({ showModuleNavigation })),
    ...['missing', null, 1, true].map(status => ({ dashboard: { status } })),
    ...[-1, 100.01, '50', true].map(remaining => ({ dashboard: { status: 'ready', primary: { remaining } } })),
    ...[-1, 1000000, 1.1, '0', true].map(count => ({ dashboard: { status: 'ready', count } })),
    { dashboard: { status: 'ready', countMore: 'true' } },
    { dashboard: { status: 'ready', boxes: Array(4).fill({ count: 1 }) } },
    { dashboard: { status: 'ready', boxes: [false] } },
    { dashboard: { status: 'ready', title: 'x'.repeat(33) } },
    { dashboard: { status: 'ready', detail: 'x'.repeat(49) } },
    { dashboard: { status: 'ready', primary: { label: 'x'.repeat(17) } } },
    { dashboard: { status: 'ready', primary: { provider: 'x'.repeat(17) } } },
    { dashboard: { status: 'ready', secondary: { provider: 1 } } },
    { dashboard: { status: 'ready', primary: { provider: '\u00e9'.repeat(9) } } },
    { dashboard: { status: 'ready', secondary: { reset: 'x'.repeat(25) } } },
  ];
  assert.deepEqual(parse(...invalid), invalid.map(() => null));
});

test('clock accepts both hour formats, all weekdays and four-module navigation', needsIdf, () => {
  const values = [
    ['5:20', 'Wed'], ['12:00', 'Sun'], ['12:59', 'Mon'], ['1:01', 'Tue'],
    ['5:20pm', 'Wed'], ['12:00am', 'Sun'], ['12:59pm', 'Mon'], ['1:01am', 'Tue'],
    ['00:00', 'Thu'], ['17:20', 'Fri'], ['23:59', 'Sat'], ['5:20', ''],
  ];
  const results = parse(...values.map(([time, weekday]) => ({
    module: 'clock', moduleIndex: 3, moduleCount: 4, showModuleNavigation: true,
    dashboard: { status: 'ready', time, weekday },
  })));
  results.forEach((result, index) => {
    assert.equal(result.kind, 3);
    assert.equal(result.index, 3);
    assert.equal(result.modules, 4);
    assert.equal(result.navigation, true);
    assert.equal(result.time, values[index][0]);
    assert.equal(result.weekday, values[index][1]);
  });
  assert.equal(parse({ module: 'clock', dashboard: { status: 'loading' } })[0].status, 1);
});

test('Roon accepts bounded UTF-8 track data, playback flags and five-module navigation', needsIdf, () => {
  const dashboard = { status: 'ready', track: '\u00e9'.repeat(32), artist: 'x'.repeat(64), artId: 'a'.repeat(40), playing: true, canPrevious: false, canNext: true };
  const result = parse({ module: 'roon', moduleIndex: 4, moduleCount: 5, dashboard })[0];
  assert.equal(result.kind, 4); assert.equal(result.index, 4); assert.equal(result.modules, 5);
  assert.equal(result.expanded, false);
  assert.equal(parse({ module: 'roon', dashboard: { ...dashboard, expanded: true } })[0].expanded, true);
  assert.equal(parse({ module: 'roon', dashboard: { ...dashboard, expanded: false } })[0].expanded, false);
  assert.ok(parse({ module: 'roon', dashboard: { ...dashboard, artId: '', track: '', artist: '' } })[0]);
  assert.equal(parse({ module: 'roon', dashboard: { status: 'loading' } })[0].status, 1);
  const invalid = [
    ...[null, 1, 0, 'true', [], {}].map(expanded => ({ ...dashboard, expanded })),
    ...['track', 'artist', 'artId', 'playing', 'canPrevious', 'canNext'].map(key => ({ ...dashboard, [key]: undefined })),
    ...['track', 'artist'].flatMap(key => [null, true, 42, 'x'.repeat(65), '\u00e9'.repeat(33), 'a\nb'].map(value => ({ ...dashboard, [key]: value }))),
    ...['x', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), null].map(artId => ({ ...dashboard, artId })),
    ...['playing', 'canPrevious', 'canNext'].flatMap(key => [null, 1, 'true'].map(value => ({ ...dashboard, [key]: value }))),
  ].map(dashboard => ({ module: 'roon', dashboard }));
  assert.deepEqual(parse(...invalid), invalid.map(() => null));
});

test('clock rejects malformed or unsupported times and weekdays', needsIdf, () => {
  const frames = [
    ...[undefined, null, true, 520, '', '0:20', '5:2', '5:60', '5:20 ', '5:2pm', '05:20pm', '0:20am', '13:20pm',
      '24:00', '23:60', '12:60am', '12:59PM', '12:59xm', '12:59pa', '5:20pm ', '5\n20pm',
      '\u0665:20pm'].map(time => ({ time, weekday: 'Wed' })),
    ...[undefined, null, true, 3, 'wed', 'Wednesday', 'Xxx', 'We\n', '\u00e9'].map(weekday => ({ time: '5:20pm', weekday })),
  ].map(fields => ({ module: 'clock', dashboard: { status: 'ready', ...fields } }));
  assert.deepEqual(parse(...frames), frames.map(() => null));
});

test('clock separator blinking is optional for old bridges and strictly validates its boolean', needsIdf, () => {
  const frame = blinkSeparator => ({ module: 'clock', dashboard: { status: 'ready', time: '12:59', weekday: 'Wed', blinkSeparator } });
  assert.deepEqual(parse(...[undefined, false, true].map(frame)).map(result => result.blinkSeparator), [false, false, true]);
  const invalid = [null, 0, 1, 'true', [], {}].map(frame);
  assert.deepEqual(parse(...invalid), invalid.map(() => null));
});
test('usage pages require paired integer bounds and preserve valid page limits', needsIdf, () => {
  const invalid = [
    { pageIndex: 0 }, { pageCount: 1 }, { pageIndex: 0, pageCount: 0 },
    { pageIndex: 0, pageCount: 257 }, { pageIndex: 256, pageCount: 256 },
    { pageIndex: -1, pageCount: 2 }, { pageIndex: 0.5, pageCount: 2 },
    { pageIndex: 0, pageCount: 1.5 }, { pageIndex: '0', pageCount: 2 },
    { pageIndex: 0, pageCount: true }, { pageIndex: null, pageCount: 1 },
  ].map(paging => ({ module: 'usage', dashboard: { status: 'ready', ...paging } }));
  assert.deepEqual(parse(...invalid), invalid.map(() => null));
  const valid = parse(
    { module: 'usage', dashboard: { status: 'ready', pageIndex: 0, pageCount: 1 } },
    { module: 'usage', dashboard: { status: 'ready', pageIndex: 255, pageCount: 256, primary: { provider: '\u00e9'.repeat(8) } } },
  );
  assert.equal(valid[0].pageIndex, 0); assert.equal(valid[0].pageCount, 1);
  assert.equal(valid[1].pageIndex, 255); assert.equal(valid[1].pageCount, 256); assert.equal(valid[1].providerBytes, 16);
});
test('module parser accepts every connection state and bounded fractional percentages', needsIdf, () => {
  const statuses = ['ready', 'loading', 'unavailable', 'auth', 'error'];
  const results = parse(...statuses.map(status => ({ module: 'usage', dashboard: { status, primary: { label: 'Session', remaining: 73.25, reset: 'Resets in 2h' } } })));
  results.forEach((result, index) => { assert.equal(result.status, index); assert.equal(result.remaining, 73.25); });
});

test('navigation is hidden by default without changing swipe module count', needsIdf, () => {
  const frames = [undefined, false, true].map(showModuleNavigation => ({ moduleIndex: 1, moduleCount: 3, showModuleNavigation }));
  const results = parse(...frames);
  assert.deepEqual(results.map(item => item.navigation), [false, false, true]);
  assert.ok(results.every(item => item.index === 1 && item.modules === 3));
});

test('cached refresh state is optional and accepts only booleans', needsIdf, () => {
  const valid = parse({}, ...[undefined, false, true].map(refreshing => ({ module: 'usage', dashboard: { status: 'ready', refreshing } })));
  assert.deepEqual(valid.map(item => item.refreshing), [false, false, false, true]);
  const invalid = [null, 'true', 1, 0, [], {}].map(refreshing => ({ module: 'usage', dashboard: { status: 'ready', refreshing } }));
  assert.deepEqual(parse(...invalid), invalid.map(() => null));
});

test('card backgrounds default off and accept only boolean settings across modules', needsIdf, () => {
  const legacy = parse({})[0];
  assert.equal(legacy.cardBackgrounds, false);
  for (const module of ['usage', 'hey']) {
    const frames = [undefined, true, false, true, undefined].map(showCardBackgrounds => ({
      module, showCardBackgrounds, dashboard: { status: 'ready' },
    }));
    assert.deepEqual(parse(...frames).map(item => item.cardBackgrounds), [false, true, false, true, false]);
  }
  const invalid = [null, 'true', 1, 0, [], {}].map(showCardBackgrounds => ({ showCardBackgrounds }));
  assert.deepEqual(parse(...invalid), invalid.map(() => null));
});

test('HEY pages preserve bounded sender and subject strings, including UTF-8', needsIdf, () => {
  const results = parse(
    { module: 'hey', dashboard: { status: 'ready', items: [], pageIndex: 0, pageCount: 1 } },
    { module: 'hey', dashboard: { status: 'ready', items: [
      { sender: 'x'.repeat(32), subject: 'y'.repeat(64) },
      { sender: '\u00e9'.repeat(16), subject: '\u00e9'.repeat(32) },
      { sender: '\ud83d\ude00'.repeat(8), subject: '\u20ac'.repeat(21) },
    ], pageIndex: 2, pageCount: 3 } },
    { module: 'hey', dashboard: { status: 'ready', count: 14 } },
  );
  assert.equal(results[0].messages, 0);
  assert.equal(results[0].pageCount, 1);
  assert.equal(results[1].messages, 3);
  assert.deepEqual(results[1].messageBytes, [[32, 64], [32, 64], [32, 63]]);
  assert.equal(results[1].pageIndex, 2);
  assert.equal(results[1].pageCount, 3);
  assert.equal(results[2].hasCount, true);
  assert.equal(results[2].messages, 0);
});

test('HEY rows reject missing fields, invalid types, controls and oversized UTF-8', needsIdf, () => {
  const invalid = [null, {}, false, 0, '',
    [null], [false], ['mail'], [{}], [{ sender: 'A' }], [{ subject: 'B' }],
    ...[null, false, 42, {}, []].flatMap(value => [
      [{ sender: value, subject: 'B' }], [{ sender: 'A', subject: value }],
    ]),
    [{ sender: 'x'.repeat(33), subject: 'B' }],
    [{ sender: 'A', subject: 'x'.repeat(65) }],
    [{ sender: '\u00e9'.repeat(17), subject: 'B' }],
    [{ sender: 'A', subject: '\u20ac'.repeat(22) }],
    [{ sender: 'A\nB', subject: 'C' }],
    [{ sender: 'A', subject: 'B\tC' }],
    Array(4).fill({ sender: 'A', subject: 'B' }),
  ].map(items => ({ module: 'hey', dashboard: { status: 'ready', items } }));
  assert.deepEqual(parse(...invalid), invalid.map(() => null));

  for (const bytes of [
    [0x80], [0xc0, 0x80], [0xc2], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
    [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80],
  ]) {
    const input = Buffer.concat([
      Buffer.from('{"module":"hey","dashboard":{"status":"ready","items":[{"sender":"'),
      Buffer.from(bytes), Buffer.from('","subject":"B"}]}}\n'),
    ]);
    assert.equal(execFileSync(parser, [], { input, encoding: 'utf8' }).trim(), 'null');
  }
});

test('card targets keep bounded opaque tokens and strict optional openable flags', needsIdf, () => {
  const token = 'abcdef0123'.repeat(4);
  const [usage, hey, old] = parse(
    { module: 'usage', dashboard: { status: 'ready', openToken: token, primary: { remaining: null, openable: true }, secondary: { remaining: 80, openable: false } } },
    { module: 'hey', dashboard: { status: 'ready', openToken: token, items: [{ sender: 'Alice', subject: 'Hello', openable: true }, { sender: 'Bob', subject: 'World', openable: false }] } },
    { module: 'usage', dashboard: { status: 'ready', primary: { remaining: 10 } } });
  assert.equal(usage.openToken, token); assert.deepEqual(usage.openable, [true, false]);
  assert.equal(hey.openToken, token); assert.deepEqual(hey.messageOpenable, [true, false, false]);
  assert.equal(old.openToken, ''); assert.deepEqual(old.openable, [false, false]);
  for (const openToken of ['', token.slice(1), token + 'a', token.toUpperCase(), 'z'.repeat(40), 1, null, true, {}])
    assert.equal(parse({ module: 'usage', dashboard: { status: 'ready', openToken } })[0], null);
  for (const openable of [1, 0, 'true', null, {}, []]) {
    assert.equal(parse({ module: 'usage', dashboard: { status: 'ready', primary: { remaining: 10, openable } } })[0], null);
    assert.equal(parse({ module: 'hey', dashboard: { status: 'ready', items: [{ sender: 'Alice', subject: 'Hello', openable }] } })[0], null);
  }
});

test('device theme validates all semantic color tokens and preserves legacy frames', needsIdf, () => {
  const palette={background:0xffffff,foreground:0,muted:0x666666,surface:0xf0f0f0,track:0xdcdcdc,accent:0x65c18c,success:0x65c18c,warning:0xd9be81,danger:0xe88483};
  assert.ok(parse({theme:'light',palette})[0]);
  assert.ok(parse({theme:'dark',palette})[0]);
  for (const key of Object.keys(palette)) {
    for(const value of [-1,0x1000000,1.5,'#ffffff',null,true]) assert.equal(parse({palette:{...palette,[key]:value}})[0],null);
    const missing={...palette};delete missing[key];assert.equal(parse({palette:missing})[0],null);
  }
  for(const theme of [null,1,true,'system','blue'])assert.equal(parse({theme})[0],null);
});


test('Now Playing sources retain navigation while unavailable and bound like flags', needsIdf, () => {
  const frames = ['roon', 'spotify', 'system', 'appleMusic'].map((player, pageIndex) => ({module: 'roon', dashboard: {
    status: 'unavailable', player, pageIndex, pageCount: 4, canLike: player === 'spotify', liked: player === 'spotify',
  }}));
  const results = parse(...frames);
  results.forEach((result, index) => {
    assert.equal(result.player, index); assert.equal(result.pageCount, 4); assert.equal(result.pageIndex, index);
    assert.equal(result.canLike, index === 1); assert.equal(result.liked, index === 1);
  });
  const legacy = parse({module: 'roon', dashboard: {status: 'loading'}})[0];
  assert.equal(legacy.player, 0); assert.equal(legacy.canLike, false); assert.equal(legacy.liked, false);
  const invalid = [{player: 'other'}, {player: null}, {player: 1}, {canLike: 'true'}, {liked: 1}, {liked: null}];
  assert.deepEqual(parse(...invalid.map(fields => ({module: 'roon', dashboard: {status: 'loading', ...fields}}))), invalid.map(() => null));
});


test('Audio preserves input/output device targets and rejects malformed controls', needsIdf, () => {
  const dashboard = {status:'ready',scope:'output',deviceId:17,deviceName:'Built-in speakers',nextDeviceId:42,deviceCount:2,volume:52.5,muted:false,canVolume:true,canMute:true,pageIndex:0,pageCount:2};
  const result = parse({module:'audio',moduleIndex:5,moduleCount:6,dashboard})[0];
  assert.equal(result.kind,5); assert.equal(result.modules,6); assert.equal(result.audioDevice,17);
  assert.equal(result.audioNextDevice,42); assert.equal(result.audioDeviceCount,2); assert.equal(result.audioInput,0); assert.equal(result.audioVolume,52.5); assert.equal(result.audioCanVolume,1); assert.equal(result.audioCanMute,1);
  const input = parse({module:'audio',dashboard:{...dashboard,scope:'input',pageIndex:1,muted:true}})[0];
  assert.equal(input.audioInput,1); assert.equal(input.audioMuted,1);
  const unavailable = parse({module:'audio',dashboard:{...dashboard,status:'unavailable',deviceId:0,volume:null,muted:null}})[0];
  assert.equal(unavailable.pageCount,2); assert.equal(unavailable.audioCanVolume,0); assert.equal(unavailable.audioCanMute,0);
  const invalid = [{nextDeviceId:-1},{nextDeviceId:0x100000000},{deviceCount:1.5},{scope:'other'},{scope:null},{deviceId:-1},{deviceId:1.5},{deviceId:0x100000000},{deviceName:'x'.repeat(65)},{volume:101},{volume:-1},{volume:'50'},{muted:0},{canVolume:null},{canMute:'true'},{pageIndex:1},{pageCount:3}];
  assert.deepEqual(parse(...invalid.map(fields=>({module:'audio',dashboard:{...dashboard,...fields}}))),invalid.map(()=>null));
});


test('Audio picker accepts visible device pages and rejects malformed rows',needsIdf,()=>{
  const dashboard={status:'ready',scope:'output',deviceId:17,deviceName:'Speakers',volume:50,muted:false,canVolume:true,canMute:true,pickerOpen:true,pageIndex:2,pageCount:3,devices:[{id:17,name:'Speakers',active:true},{id:42,name:'External DAC',active:false}]};
  const value=parse({module:'audio',dashboard})[0];
  assert.equal(value.audioPicker,1);assert.equal(value.audioRows,2);assert.deepEqual(value.audioRowIDs,[17,42,0]);assert.equal(value.pageIndex,2);
  const invalid=[{pickerOpen:'true'},{devices:null},{devices:Array(4).fill(dashboard.devices[0])},{devices:[{id:0,name:'Bad',active:false}]},{devices:[{id:42,name:'x'.repeat(65),active:false}]},{devices:[{id:42,name:'Bad',active:1}]},{devices:[dashboard.devices[0],dashboard.devices[0]]}];
  assert.deepEqual(parse(...invalid.map(fields=>({module:'audio',dashboard:{...dashboard,...fields}}))),invalid.map(()=>null));
  const missing={...dashboard};delete missing.devices;assert.equal(parse({module:'audio',dashboard:missing})[0],null);
});
