#!/usr/bin/env python3
"""Exercise attention parsing and rendering. Stop the bridge before running."""
import argparse
import json
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('port')
args = parser.parse_args()
with serial.Serial(args.port, 115200, timeout=0.15, write_timeout=2) as device:
    def receive(predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                value = json.loads(device.readline())
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(value, dict) and predicate(value):
                return value
        return None

    assert receive(lambda value: value.get('type') == 'ready', 12), 'No ready frame'
    seq = 980000
    base = dict(type='state', v=1, state='done', label='Attention test', name='Tap to review',
                counts=dict(working=0, blocked=0, done=1, idle=0, unknown=0), rotation=85,
                module='face', moduleCount=1, moduleIndex=0)
    attention = dict(id='12345678-abcd-1234-abcd-123456789012', revision=1, detail=False,
                     body='Read this request. ' * 24,
                     actions=[dict(id='approve', label='Approve'), dict(id='cancel', label='Cancel')])

    def send(payload):
        wire = (json.dumps(payload, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        assert len(wire) <= 2048
        device.write(wire)

    def render(extra):
        global seq
        seq += 1
        payload = dict(base, seq=seq, **extra)
        send(payload)
        assert receive(lambda value: value.get('seq') == seq and value.get('type') == 'ack'), payload
        time.sleep(0.8)
        send(payload)
        ack = receive(lambda value: value.get('seq') == seq and value.get('type') == 'ack')
        assert ack and ack.get('rendered_seq') == seq and not ack.get('panel_error') and not ack.get('font_error'), ack
        return ack

    for theme in ['light', 'dark']:
        for detail in [False, True, False]:
            a = dict(attention, detail=detail)
            ack = render(dict(attention=a, theme=theme))
            assert ack['rotation'] == 85 and ack['theme'] == theme, ack
        render(dict(theme=theme))
    print('PASS: attention summary, details and clear render at85 degrees in both themes')
    for invalid in [dict(attention, revision=-1), dict(attention, actions=[]),
                    dict(attention, body='x' * 481),
                    dict(attention, actions=[dict(id='open', label='Unsafe')])]:
        seq += 1
        send(dict(base, seq=seq, attention=invalid))
        assert not receive(lambda value: value.get('seq') == seq and value.get('type') == 'ack', 0.5)
    render({})
    print('PASS: invalid attention is rejected and normal rendering recovers')
