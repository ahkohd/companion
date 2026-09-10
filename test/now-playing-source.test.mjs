import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalMusicSource } from '../bridge/local-music-source.mjs';
import { NowPlayingSource } from '../bridge/now-playing-source.mjs';
import { defaultSettings, mergeSettings } from '../bridge/studio-settings.mjs';
import { FaceStore } from '../bridge/store.mjs';

class Source extends EventEmitter {
  value = { status: 'ready', track: 'Track', artist: 'Artist', zoneId: 'zone', artId: null, canPrevious: true, canNext: true };
  configure(config) { this.config = config; }
  start() {}
  stop() {}
  snapshot() { return this.value; }
  async artwork() { return null; }
  async control(action) { this.lastAction = action; }
}
const fixture = (options = {}) => { const sources = { roon: new Source(), spotify: new Source(), appleMusic: new Source(), system: new Source() }; return { sources, music: new NowPlayingSource({ sources, ...options }) }; };

test('players enable independently, vertical selection skips disabled sources and does not control playback', async () => {
  const { sources, music } = fixture();
  music.configure({ enabled: true, players: { roon: true, spotify: false, system: true } });
  assert.equal(sources.spotify.config.enabled, false);
  assert.equal(music.select({ direction: 1 }).player, 'system');
  assert.equal(music.snapshot().pageCount, 2);
  assert.equal(music.select({ direction: 1 }).player, 'roon');
  assert.equal(sources.roon.lastAction, undefined);
  music.select({ id: 'system' });
  await assert.rejects(music.control('next', 'roon'), /player changed/);
  await music.control('next', 'system');
  assert.equal(sources.system.lastAction, 'next');
  music.configure({ enabled: true, players: { roon: true, spotify: false, system: false } });
  assert.equal(music.player, 'roon');
  assert.throws(() => music.select({ id: 'spotify' }), /Enable/);
});

test('player badges open only the named app without playback and reject stale or invalid requests', async () => {
  const calls = [];
  let code = 0;
  const { music, sources } = fixture({ platform: 'darwin', runner: async (...args) => { calls.push(args); return { code }; } });
  const players = { roon: true, spotify: true, appleMusic: true, system: true };
  music.configure({ enabled: true, players });
  for (const [player, bundle] of [['roon', 'com.roon.Roon'], ['spotify', 'com.spotify.client'], ['appleMusic', 'com.apple.Music']]) {
    music.select({ id: player });
    await music.control('open', player);
    assert.deepEqual(calls.at(-1), ['/usr/bin/open', ['-b', bundle], { timeoutMs: 10000, maxOutputBytes: 4096 }]);
  }
  assert.ok(Object.values(sources).every(source => source.lastAction === undefined));
  for (const player of [undefined, null, 'system', 'constructor', '__proto__', 'com.apple.Terminal', ['appleMusic'], {}]) {
    await assert.rejects(music.control('open', player));
  }
  await assert.rejects(music.control('open', 'roon'), /changed/);
  music.configure({ enabled: true, players: { ...players, appleMusic: false } });
  await assert.rejects(music.control('open', 'appleMusic'), /changed/);
  music.configure({ enabled: false, players });
  await assert.rejects(music.control('open', 'roon'), /changed/);
  music.configure({ enabled: true, players });
  music.platform = 'linux';
  await assert.rejects(music.control('open', 'roon'), /macOS/);
  assert.equal(calls.length, 3);
  music.platform = 'darwin'; code = 1;
  await assert.rejects(music.control('open', 'roon'), /Could not open Roon/);
  music.runner = async () => { throw Error('ETIMEDOUT'); };
  await assert.rejects(music.control('open', 'roon'), /ETIMEDOUT/);
  assert.ok(Object.values(sources).every(source => source.lastAction === undefined));
});

test('player settings validate and frames stay below the 2048 byte serial limit', () => {
  const settings = mergeSettings(defaultSettings(), { modules: { roon: { enabled: true, players: { spotify: true, system: true } } }, device: { activeModule: 'roon' } });
  assert.throws(() => mergeSettings(settings, { modules: { roon: { players: { roon: false, spotify: false, system: false } } } }), /at least one/);
  const store = new FaceStore(); store.setSettings(settings, 1); store.activeModule = 'roon';
  store.setSources({ roon: { status: 'ready', player: 'spotify', playerName: 'Spotify', pageIndex: 1, pageCount: 3, track: 'x'.repeat(64), artist: 'y'.repeat(64), artId: 'a'.repeat(40), playing: true, canNext: true, canPrevious: true } });
  assert.equal(store.display().dashboard.status, 'ready');
  assert.equal(store.display().dashboard.player, 'spotify');
  assert.ok(Buffer.byteLength(JSON.stringify(store.frame()) + '\n') <= 2048);
});

test('local Spotify uses bounded commands, maps tracks, and never offers unsupported likes', async t => {
  const calls = [];
  const source = new LocalMusicSource({ player: 'spotify', platform: 'darwin', runner: async (...args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ running: true, title: 'Song', artist: 'Artist', playing: true }) }; }, intervalMs: 100000 });
  t.after(() => source.stop()); source.configure({ enabled: true }); source.started = true; await source.poll();
  assert.equal(source.snapshot().track, 'Song'); assert.equal(source.snapshot().canLike, false);
  await assert.rejects(source.control('like'), /not supported/);
  await source.control('next'); assert.ok(calls.some(call => call[1].at(-1) === 'next')); assert.equal(calls.at(-1)[2].timeoutMs, 5000);
});

test('disabled sources ignore late reads and abort in-flight commands', async () => {
  let resolveRead;
  const source = new LocalMusicSource({ player: 'spotify', platform: 'darwin', runner: () => new Promise(resolve => { resolveRead = resolve; }) });
  source.configure({ enabled: true }); source.started = true;
  const pending = source.poll(); source.stop();
  resolveRead({ code: 0, stdout: JSON.stringify({ title: 'Stale', running: true }) }); await pending;
  assert.equal(source.snapshot().status, 'disabled'); assert.equal(source.snapshot().track, '');
});

test('system controls reject an active player change rather than target another app', async t => {
  const calls = [];
  const source = new LocalMusicSource({ player: 'system', platform: 'darwin', runner: async (command, args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ title: 'Other', bundleIdentifier: 'other.app' }) }; } });
  t.after(() => source.stop()); source.started = true; source.enabled = true; source.bundleIdentifier = 'original.app'; source.value = { ...source.value, status: 'ready', canNext: true };
  await assert.rejects(source.control('next'), /active Mac player changed/);
  assert.equal(calls.length, 1); assert.equal(calls[0].at(-1), 'get');
});

test('late artwork conversion cannot replace a newer generation', async t => {
  let resolveOld, enteredOld;
  const entered = new Promise(resolve => { enteredOld = resolve; });
  let title = 'Old';
  const source = new LocalMusicSource({ player: 'system', platform: 'darwin', intervalMs: 100000,
    runner: async () => ({ code: 0, stdout: JSON.stringify({ title, artworkData: Buffer.from(title).toString('base64') }) }),
    converter: async bytes => bytes.toString() === 'Old' ? new Promise(resolve => { resolveOld = resolve; enteredOld(); }) : { id: 'b'.repeat(40) },
  });
  t.after(() => source.stop()); source.enabled = true; source.started = true;
  const old = source.poll(); await entered;
  source.stop(); title = 'New'; source.started = true; source.enabled = true;
  await source.poll(); resolveOld({ id: 'a'.repeat(40) }); await old;
  assert.equal(source.snapshot().track, 'New'); assert.equal(source.snapshot().artId, 'b'.repeat(40)); assert.equal(source.art.id, 'b'.repeat(40));
});

test('missing macOS artwork does not erase the current cover and failures can retry', async t => {
  let hasArt = true, attempts = 0;
  const source = new LocalMusicSource({ player: 'system', platform: 'darwin', intervalMs: 100000,
    runner: async () => ({ code: 0, stdout: JSON.stringify({ title: 'Song', ...(hasArt ? { artworkData: 'YQ==' } : {}) }) }),
    converter: async () => { attempts++; if (attempts === 1) throw Error('temporary decode failure'); return { id: 'b'.repeat(40) }; },
  });
  t.after(() => source.stop()); source.enabled = true; source.started = true;
  await source.poll(); assert.equal(source.snapshot().status, 'ready'); assert.equal(source.snapshot().artId, null);
  clearTimeout(source.timer); source.artRetryAt = 0; await source.poll(); assert.equal(source.snapshot().artId, 'b'.repeat(40));
  clearTimeout(source.timer); hasArt = false; await source.poll(); assert.equal(source.snapshot().artId, 'b'.repeat(40));
});

test('Apple Music defaults off, supports independent selection, and survives legacy settings', async () => {
  const settings = mergeSettings(defaultSettings(), { modules: { roon: { players: { roon: true, spotify: true, system: true } } } });
  assert.equal(settings.modules.roon.players.appleMusic, false);
  const { music, sources } = fixture();
  music.configure({enabled:true,players:{roon:true,spotify:true,appleMusic:true,system:true}});
  assert.equal(music.select({id:'appleMusic'}).playerName, 'Apple Music');
  assert.equal(music.snapshot().pageCount, 4);
  await music.control('next','appleMusic');
  assert.equal(sources.appleMusic.lastAction,'next');
  assert.equal(sources.spotify.lastAction,undefined);
  assert.equal(music.select({direction:1}).player,'system');
  await assert.rejects(music.control('next','appleMusic'),/changed/);
});

test('Apple Music reads local artwork and routes controls to Music, independently of System', async t => {
  const calls=[];
  const source=new LocalMusicSource({player:'appleMusic',platform:'darwin',intervalMs:100000,
    runner:async (command,args,options)=>{calls.push({command,args,options});return {code:0,stdout:JSON.stringify({running:true,title:'Music song',artist:'Artist',trackId:'ABC',bundleIdentifier:'com.apple.Music',artworkData:'Y292ZXI=',playing:false})}},
    converter:async(bytes,player)=>{assert.equal(bytes.toString(),'cover');assert.equal(player,'appleMusic');return {id:'c'.repeat(40)}}});
  t.after(()=>source.stop());source.configure({enabled:true});source.started=true;await source.poll();
  assert.equal(source.snapshot().status,'ready');assert.equal(source.snapshot().playing,false);assert.equal(source.snapshot().artId,'c'.repeat(40));
  await source.control('playpause');
  assert.ok(calls.some(c=>c.args.at(-1)==='playpause'));
  assert.ok(calls.every(c=>c.command==='/usr/bin/osascript'&&c.args[2].endsWith('/apple-music.jxa')&&c.options.timeoutMs===5000));
  await assert.rejects(source.control('like'),/not supported/);
});

test('Apple Music reports closed app and automation denial clearly', async t => {
  let code=0;
  const source=new LocalMusicSource({player:'appleMusic',platform:'darwin',intervalMs:100000,runner:async()=>({code,stdout:'{"running":false}'})});
  t.after(()=>source.stop());source.configure({enabled:true});source.started=true;await source.poll();
  assert.equal(source.snapshot().status,'unavailable');assert.match(source.snapshot().error,/Open Music/);
  clearTimeout(source.timer);code=1;await source.poll();
  assert.equal(source.snapshot().status,'error');assert.match(source.snapshot().error,/control Music/);
});

test('track transitions retain the previous frame until metadata and artwork are ready', async t => {
  let data={running:true,title:'Old',artworkData:'YQ=='};
  const source=new LocalMusicSource({player:'appleMusic',platform:'darwin',intervalMs:100000,runner:async()=>({code:0,stdout:JSON.stringify(data)}),converter:async()=>({id:'old'})});
  t.after(()=>source.stop());source.enabled=true;source.started=true;await source.poll();clearTimeout(source.timer);
  data={running:true};await source.poll();clearTimeout(source.timer);
  assert.equal(source.snapshot().track,'Old');assert.equal(source.snapshot().artId,'old');
  let finish;source.converter=()=>new Promise(resolve=>{finish=resolve});data={running:true,title:'New',artworkData:'Yg=='};
  const pending=source.poll();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(source.snapshot().track,'Old');assert.equal(source.snapshot().artId,'old');
  finish({id:'new'});await pending;clearTimeout(source.timer);
  assert.equal(source.snapshot().track,'New');assert.equal(source.snapshot().artId,'new');
  data={running:true};source.missingSince=Date.now()-9000;await source.poll();clearTimeout(source.timer);
  assert.equal(source.snapshot().status,'unavailable');
});

test('system controls reject a new app until its artwork and track are displayed', async t => {
  let data = { title: 'Old', bundleIdentifier: 'old.app', artworkData: 'YQ==' };
  const commands = [];
  const source = new LocalMusicSource({ player: 'system', platform: 'darwin', intervalMs: 100000,
    runner: async (_, args) => {
      if (args.includes('send')) { commands.push(args); return { code: 0, stdout: '' }; }
      return { code: 0, stdout: JSON.stringify(data) };
    },
    converter: async () => ({ id: 'old' }),
  });
  t.after(() => source.stop()); source.enabled = true; source.started = true;
  await source.poll(); clearTimeout(source.timer);
  let finish, entered;
  const converting = new Promise(resolve => { entered = resolve; });
  source.converter = () => new Promise(resolve => { finish = resolve; entered(); });
  data = { title: 'New', bundleIdentifier: 'new.app', artworkData: 'Yg==' };
  const pending = source.poll(); await converting;
  assert.equal(source.snapshot().track, 'Old');
  assert.equal(source.snapshot().artId, 'old');
  await assert.rejects(source.control('next'), /active Mac player changed/);
  assert.equal(commands.length, 0);
  finish({ id: 'new' }); await pending; clearTimeout(source.timer);
  assert.equal(source.snapshot().track, 'New');
  assert.equal(source.snapshot().artId, 'new');
  await source.control('next');
  assert.equal(commands.length, 1);
});
