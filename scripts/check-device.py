#!/usr/bin/env python3
"""Check the flashed display protocol. Stop the bridge before running this."""
import argparse
import json
import time

import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('port')
args = parser.parse_args()

with serial.Serial(args.port, 115200, timeout=0.15, write_timeout=2) as device:
    incoming = bytearray()

    def receive_until(predicate, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            incoming.extend(device.readline())
            if not incoming.endswith(b'\n'):
                continue
            line = bytes(incoming)
            incoming.clear()
            try:
                message = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(message, dict) and predicate(message):
                return message
        raise AssertionError('Expected device response was not received')

    def rendered_ack(payload):
        drawn = None
        started = time.monotonic()
        deadline = started + 3
        attempts = 0
        while time.monotonic() < deadline:
            device.write((json.dumps(payload) + '\n').encode())
            attempts += 1
            try:
                drawn = receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == payload['seq'],
                                      max(0, deadline - time.monotonic()))
            except AssertionError as error:
                raise AssertionError(f"Frame {payload['seq']} was not rendered: {drawn}") from error
            if drawn.get('rendered_seq') == payload['seq']:
                if attempts > 1:
                    print(f"NOTE: frame {payload['seq']} needed {attempts} render checks ({time.monotonic() - started:.3f}s)", flush=True)
                return drawn
            time.sleep(0.03)
        raise AssertionError(f"Frame {payload['seq']} was not rendered: {drawn}")

    ready = lambda m: m.get('type') == 'ready' and m.get('v') == 1 and m.get('board') == 'waveshare-1.75-b'
    receive_until(ready, 12)
    device.write(b'\n')  # Discard any partial frame left when the bridge stopped.
    print('PASS: firmware identifies the board and protocol', flush=True)

    counts = dict(working=1, blocked=0, done=0, idle=0, unknown=0)
    shapes = dict(working=[[24, 46], [20, 38]], blocked=[[35.6, 87.5], [35.6, 87.5]],
                  done=[[23.6, 46.4], [44.7, 8.9]], idle=[[18.6, 41.2], [18.6, 41.2]],
                  sleep=[[40, 7], [40, 7]], unknown=[[20, 44], [28, 17]], disconnected=[[40, 7], [40, 7]])
    render_times = []
    for seq, state in enumerate(['working', 'blocked', 'done', 'idle', 'sleep', 'unknown', 'disconnected'], 900001):
        payload = dict(type='state', v=1, seq=seq, state=state, label='Protocol check', name='Herdr Face', counts=counts, preview=True)
        device.write((json.dumps(payload) + '\n').encode())
        receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
        time.sleep(0.65)
        drawn = rendered_ack(payload)
        assert drawn.get('rendered_seq') == seq, drawn
        assert drawn.get('shimmer_pixels', 0) > 100 if state == 'working' else drawn.get('shimmer_pixels') == 0, drawn
        assert drawn.get('text_gap') == 8 and drawn.get('status_top') == 360, drawn
        for actual, expected in zip(drawn['eyes'], shapes[state]):
            assert all(abs(a - b) < 0.02 for a, b in zip(actual, expected)), (state, drawn)
        render_times.append(drawn['render_us'])
    print('PASS: all seven states acknowledged, including immediate sleep', flush=True)
    print(f'PASS: actual rendered eye shapes match all seven expressions; raster time {min(render_times)} to {max(render_times)} us', flush=True)
    assert max(render_times) < 33000, render_times

    for seq, (state, age) in enumerate([('working', 5000), ('done', 1100), ('done', 5000)], 900010):
        payload.update(seq=seq, state=state, animationMs=20000, ageMs=age)
        device.write((json.dumps(payload) + '\n').encode())
        receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
        time.sleep(0.1)
        drawn = rendered_ack(payload)
        assert drawn.get('rendered_seq') == seq, drawn
        assert 'decor_count' not in drawn and 'clip' not in drawn, drawn
        assert drawn['render_us'] < 33000, drawn
        print(f'PASS: {state} at {age} ms, native eyes only, {drawn["render_us"]} us', flush=True)
    payload.pop('animationMs')
    payload.pop('ageMs')

    for seq, enabled in enumerate([True, False, True], 900014):
        payload.update(seq=seq, state='working', preview=False, statusDots=enabled)
        device.write((json.dumps(payload) + '\n').encode())
        receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
        time.sleep(0.1)
        drawn = rendered_ack(payload)
        assert drawn.get('rendered_seq') == seq, drawn
        assert 100 < drawn.get('shimmer_pixels', 0) < 16384, drawn
        assert drawn['render_us'] < 33000, drawn
    print('PASS: live working text shimmer renders without duplicate dots', flush=True)
    payload.pop('statusDots')
    payload['preview'] = True

    for seq, (state, preview, label) in enumerate([
        ('working', False, 'Working'), ('working', False, '5 working'), ('working', False, '12345 working'),
        ('working', True, 'Working'), ('done', False, 'Ready'), ('idle', False, 'Idle')
    ], 900017):
        payload.update(seq=seq, state=state, preview=preview, label=label)
        device.write((json.dumps(payload) + '\n').encode())
        receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
        time.sleep(0.1)
        drawn = rendered_ack(payload)
        assert drawn.get('rendered_seq') == seq, drawn
        if state == 'working':
            assert 100 < drawn.get('shimmer_pixels', 0) < 16384, drawn
        else:
            assert drawn.get('shimmer_pixels') == 0, drawn
    print('PASS: shimmer masks update for counts and preview, then clear for Ready and Idle', flush=True)
    payload['preview'] = True

    # Text gap: status top = 395 - 27 (Geist 22 line height) - gap, for live shimmer and static Ready.
    tops = {4: 364, 8: 360, 16: 352}
    seq = 900023
    for gap in [4, 16, 8, 16, 4]:
        for state, preview, label in [('working', False, 'Working'), ('done', False, 'Ready')]:
            seq += 1
            payload.update(seq=seq, state=state, preview=preview, label=label, textGap=gap, animationMs=20000, ageMs=5000)
            device.write((json.dumps(payload) + '\n').encode())
            receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
            time.sleep(0.1)
            drawn = rendered_ack(payload)
            assert drawn.get('rendered_seq') == seq, drawn
            assert drawn.get('text_gap') == gap and drawn.get('status_top') == tops[gap], (gap, drawn)
            if state == 'working':
                assert 100 < drawn.get('shimmer_pixels', 0) < 16384, (gap, drawn)
            else:
                assert drawn.get('shimmer_pixels') == 0, (gap, drawn)  # no stale shimmer after moving the text
            assert drawn['render_us'] < 33000, drawn
    # Omitting textGap after an explicit gap returns to the balanced default.
    for key in ['textGap', 'animationMs', 'ageMs']: payload.pop(key)
    seq += 1
    payload.update(seq=seq, state='done', preview=False, label='Ready')
    device.write((json.dumps(payload) + '\n').encode())
    receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
    time.sleep(0.1)
    drawn = rendered_ack(payload)
    assert drawn.get('text_gap') == 8 and drawn.get('status_top') == 360 and drawn.get('shimmer_pixels') == 0, drawn
    print('PASS: text gap 4, 8 and 16 position status text for live shimmer and static Ready; omitted gap restores 8', flush=True)
    payload['preview'] = True

    for seq, look in enumerate([dict(x=-1, y=-1), dict(x=1, y=1), dict(x=0.25, y=-0.75), None], 900040):
        payload.update(seq=seq, look=look, state='working')
        device.write((json.dumps(payload) + '\n').encode())
        receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == seq, 3)
    print('PASS: mouse gaze corners, fractional position and release acknowledged', flush=True)

    device.write(b'null\nfactory log\n{"type":"state","v":1,"seq":900099}\n' + b'x' * 1200 + b'\n')
    invalid = {**payload, 'seq': 900099, 'preview': 'yes'}
    device.write((json.dumps(invalid) + '\n').encode())
    for extra in [dict(statusDots='yes'), dict(statusDots=True, preview=True), dict(statusDots=True, preview=False, state='idle')]:
        device.write((json.dumps({**payload, **extra, 'seq': 900099}) + '\n').encode())
    for look in [dict(x=1.1, y=0), dict(x=0, y=-1.1), dict(x='0', y=0), dict(x=0), [], True]:
        device.write((json.dumps({**payload, 'seq': 900099, 'look': look}) + '\n').encode())
    for gap in [0, 12, 8.5, -8, '8', True, None]:
        device.write((json.dumps({**payload, 'seq': 900099, 'textGap': gap}) + '\n').encode())
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        line = device.readline()
        try:
            message = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        assert not isinstance(message, dict) or message.get('type') != 'ack', message
    print('PASS: malformed and oversized frames ignored', flush=True)

    payload.update(seq=900100, state='idle', label='Checks passed', name='Herdr Face')
    device.write((json.dumps(payload) + '\n').encode())
    receive_until(lambda m: m.get('type') == 'ack' and m.get('seq') == 900100, 3)
    print('PASS: valid frame recovers after malformed input', flush=True)
    receive_until(ready, 12)
    print('PASS: host timeout resumes ready announcements', flush=True)
