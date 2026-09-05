#!/usr/bin/env python3
"""Verify every Grok clip against browser-decoded frame hashes over USB."""
import argparse
import json
import pathlib
import subprocess
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('port')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
fps = json.loads((root / 'shared/grok-manifest.json').read_text())['fps']
expected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', r'''
import {readFileSync} from 'node:fs';
import {decodeFrame} from './scripts/grok-codec.mjs';
const catalog=JSON.parse(readFileSync('shared/grok-catalog.json'));
const out={};
for(const clip of catalog){
 const b=readFileSync(`public/grok/${clip.source}.bin`),w=b.readUInt16LE(4),h=b.readUInt16LE(6),key=b.readUInt16LE(10),count=b.readUInt32LE(12),p=new Uint16Array(w*h),hashes=[];
 for(let i=0;i<count;i++){
   if(i%key===0)p.fill(0);
   if(!decodeFrame(b.subarray(b.readUInt32LE(24+i*4),b.readUInt32LE(28+i*4)),p))throw Error('decode');
   let hash=2166136261;for(const v of p)hash=Math.imul(hash^v,16777619)>>>0;hashes.push(hash);
 }
 out[clip.id]=hashes;
}
console.log(JSON.stringify(out));
'''], cwd=root))
with serial.Serial(args.port, 115200, timeout=0.15, write_timeout=2) as device:
    def receive_until(predicate, timeout=4):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                message = json.loads(device.readline())
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(message, dict) and message.get('type') == 'ack':
                assert message.get('seq') != 920099, ('Invalid frame was accepted', message)
            if isinstance(message, dict) and predicate(message):
                return message
        raise AssertionError('Device response timed out')

    def send(payload):
        device.write((json.dumps(payload) + '\n').encode())

    receive_until(lambda m: m.get('type') == 'ready', 12)
    payload = dict(type='state', v=1, state='idle', preview=True, label='Animation check', name='Grok collection',
                   animationMs=20000, ageMs=1700, counts=dict(working=0, blocked=0, done=0, idle=0, unknown=0))
    times = []
    for index, (clip, hashes) in enumerate(expected.items(), 1):
        seq = 910000 + index
        payload.update(seq=seq, epoch=seq, animation=clip)
        send(payload)
        receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq)
        time.sleep(.15)
        send(payload)
        actual = receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq)
        assert actual.get('rendered_seq') == seq and actual.get('clip') == index, (clip, actual)
        frame = actual.get('clip_frame', -1)
        assert 0 <= frame < len(hashes), (clip, actual)
        assert actual.get('clip_hash') == hashes[frame], (clip, actual, hashes[frame])
        times.append(actual['render_us'])
        print(f'PASS: {clip}, frame {frame}, matching pixels, {actual["render_us"]} us', flush=True)
    # A replay must return to the opening frames; invalid IDs must not disturb it.
    payload.update(seq=920001, epoch=920001, animation='grok:spin-wild', ageMs=0)
    send(payload)
    receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == 920001)
    time.sleep(.12)
    send(payload)
    replay = receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == 920001)
    assert 0 <= replay['clip_frame'] <= 5, replay
    send({**payload, 'seq': 920099, 'animation': 'grok:missing'})
    send({**payload, 'seq': 920099, 'animation': 4})
    send({**payload, 'seq': 920099, 'preview': False})
    for epoch in [-1, True, '1']:
        send({**payload, 'seq': 920099, 'epoch': epoch})
    payload.update(seq=920002, animation=None, state='done', ageMs=5000)
    send(payload)
    receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == 920002)
    time.sleep(.1)
    send(payload)
    restored = receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == 920002)
    assert restored['clip'] == 0, restored
    assert max(times) < 1_000_000 / fps, (f'Exceeded the {fps} fps clip budget', times)
    print(f'PASS: all {len(expected)} clips, replay and return to live; rendering {min(times)} to {max(times)} us within the {fps} fps budget', flush=True)
