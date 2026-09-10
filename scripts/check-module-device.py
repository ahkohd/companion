#!/usr/bin/env python3
"""Check display modules and live animation mappings. Stop the bridge before running."""
import argparse
import json
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('port')
args = parser.parse_args()
with serial.Serial(args.port, 115200, timeout=0.15, write_timeout=2) as device:
    incoming = bytearray()

    def receive(predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            incoming.extend(device.readline())
            if not incoming.endswith(b'\n'):
                continue
            line = bytes(incoming)
            incoming.clear()
            try:
                item = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(item, dict) and predicate(item):
                return item
        raise AssertionError('Expected device response was not received')

    receive(lambda item: item.get('type') == 'ready', 12)
    device.write(b'\n')  # Discard any partial frame left when the bridge stopped.
    seq = 910000
    base = dict(type='state', v=1, state='working', label='Module check', name='Playground',
                counts=dict(working=1, blocked=0, done=0, idle=0, unknown=0), textGap=8)

    def render(**extra):
        global seq
        seq += 1
        payload = dict(base, seq=seq, **extra)
        wire = (json.dumps(payload, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        assert len(wire) <= 1024
        device.write(wire)
        receive(lambda item: item.get('type') == 'ack' and item.get('seq') == seq)
        time.sleep(0.7)
        started = time.monotonic()
        deadline = started + 3
        result = None
        attempts = 0
        while time.monotonic() < deadline:
            device.write(wire)
            attempts += 1
            try:
                result = receive(lambda item: item.get('type') == 'ack' and item.get('seq') == seq,
                                 max(0, deadline - time.monotonic()))
            except AssertionError as error:
                raise AssertionError(f'Frame {seq} was not rendered: {result}') from error
            if result.get('rendered_seq') == seq:
                if attempts > 1:
                    print(f'NOTE: frame {seq} needed {attempts} render checks ({time.monotonic() - started:.3f}s)', flush=True)
                break
            time.sleep(0.03)
        assert result and result.get('rendered_seq') == seq, result
        assert result.get('text_gap') == 8 and result.get('status_top') == 360, result
        return result

    for status in ['loading', 'unavailable', 'auth', 'error', 'ready']:
        drawn = render(module='usage', moduleIndex=1, moduleCount=3, dashboard=dict(
            status=status, title='Codex', detail='Usage from CodexBar',
            primary=dict(provider='Codex', label='Session', remaining=73.25, reset='Resets in 2h'),
            secondary=dict(provider='Claude', label='Weekly', remaining=None, reset='Reset unavailable')))
        assert drawn.get('module') == 'usage' and drawn.get('shimmer_pixels') == 0, drawn
        assert drawn.get('page_index') == 0 and drawn.get('page_count') == 1, drawn
    print('PASS: usage module renders every connection state without the face or shimmer', flush=True)

    for page_index, page_count in [(0, 1), (0, 3), (1, 3), (2, 3), (255, 256)]:
        drawn = render(module='usage', moduleIndex=1, moduleCount=3, dashboard=dict(
            status='ready', title='', detail='', pageIndex=page_index, pageCount=page_count,
            primary=dict(provider='Claude', label='Session', remaining=3, reset='Resets in 2h'),
            secondary=dict(provider='Codex', label='Spark weekly', remaining=12, reset='Resets in 4d')))
        assert drawn.get('module') == 'usage', drawn
        assert drawn.get('page_index') == page_index and drawn.get('page_count') == page_count, drawn
    print('PASS: provider cards render each usage page, including the maximum page bound', flush=True)

    for module in ['usage', 'hey']:
        for status, refreshing in [('ready', False), ('ready', True), ('ready', False), ('loading', True), ('error', True)]:
            drawn = render(module=module, dashboard=dict(
                status=status, refreshing=refreshing, title='Imbox', detail='',
                items=[dict(sender='Alex Morgan', subject='A few thoughts on the playground')],
                primary=dict(provider='Codex', label='Session', remaining=73, reset='Resets in 2h'),
                secondary=dict(provider='Codex', label='Weekly', remaining=42, reset='Resets in 4d')))
            assert drawn.get('module') == module and drawn.get('shimmer_pixels') == 0, drawn
            assert drawn.get('refreshing') == (status == 'ready' and refreshing), drawn
    print('PASS: cached cards shimmer Checking only during ready refreshes', flush=True)

    for module in ['usage', 'hey']:
        for enabled in [None, True, False]:
            setting = {} if enabled is None else dict(showCardBackgrounds=enabled)
            drawn = render(module=module, **setting, dashboard=dict(
                status='ready', title='Imbox', detail='',
                items=[dict(sender='Alex Morgan', subject='A few thoughts on the playground')],
                primary=dict(provider='Codex', label='Session', remaining=73, reset='Resets in 2h'),
                secondary=dict(provider='Codex', label='Weekly', remaining=42, reset='Resets in 4d')))
            assert drawn.get('module') == module, drawn
    print('PASS: usage and HEY accept optional card background toggles', flush=True)

    messages = [dict(sender='Alex Morgan', subject='A few thoughts on the playground'),
                dict(sender='Design team', subject='Review the updated device interface'),
                dict(sender='Sam', subject='Coffee next week?')]
    pages = [(0, 1, []), (0, 1, messages[:1]), (0, 3, messages), (1, 3, messages), (2, 3, messages[:2]),
             (255, 256, [dict(sender='\u00e9' * 16, subject='\u00e9' * 32)]),
             (0, 1, [dict(sender='W' * 32, subject='W' * 64)] * 3)]
    for page_index, page_count, items in pages:
        drawn = render(module='hey', moduleIndex=2, moduleCount=3, dashboard=dict(
            status='ready', title='Imbox', detail='You are all caught up' if not items else '',
            pageIndex=page_index, pageCount=page_count, items=items))
        assert drawn.get('module') == 'hey' and drawn.get('shimmer_pixels') == 0, drawn
        assert drawn.get('page_index') == page_index and drawn.get('page_count') == page_count, drawn
    print('PASS: HEY renders empty and populated mail pages with bounded UTF-8 and long subjects', flush=True)

    for clock_time, weekday in [('5:20', 'Wed'), ('12:59', 'Sat'), ('12:00', 'Sun'),
                                ('00:00', 'Mon'), ('17:20', 'Tue'), ('23:59', '')]:
        drawn = render(module='clock', moduleIndex=3, moduleCount=4, showModuleNavigation=True,
                       dashboard=dict(status='ready', title='Clock', detail='', time=clock_time,
                                      weekday=weekday, refreshing=True))
        assert drawn.get('module') == 'clock' and drawn.get('shimmer_pixels') == 0, drawn
        assert drawn.get('page_index') == 0 and drawn.get('page_count') == 1, drawn
        assert drawn.get('refreshing') is False, drawn
    print('PASS: Clock renders 12-hour, 24-hour and optional weekday in four-module navigation', flush=True)

    drawn = render(module='face', expression='sleep')
    assert drawn.get('module') == 'face' and drawn.get('shimmer_pixels', 0) > 100, drawn
    assert drawn.get('refreshing') is False, drawn
    assert all(abs(eye[1] - 7) < .02 for eye in drawn['eyes']), drawn
    print('PASS: native mapping changes eye pose while preserving Working shimmer', flush=True)

    drawn = render(module='face', state='idle', expression='idle', animationMs=20000, ageMs=40000)
    assert all(abs(eye[1] - 41.2) < .02 for eye in drawn['eyes']), drawn
    drawn = render(module='face', state='idle', animationMs=20000, ageMs=40000)
    assert all(abs(eye[1] - 7) < .02 for eye in drawn['eyes']), drawn
    print('PASS: explicit idle pose stays awake; default idle retains automatic sleep', flush=True)

    invalid = [dict(module='invalid'), dict(module='hey', moduleIndex=3, moduleCount=3),
               dict(module='clock', moduleIndex=7, moduleCount=7),
               dict(expression='invalid'), dict(expression=True),
               dict(module='usage', dashboard=dict(status='ready', primary=dict(remaining=-1))),
               dict(module='usage', dashboard=dict(status='ready', primary=dict(provider='x' * 17))),
               dict(module='usage', dashboard=dict(status='ready', secondary=dict(provider=True))),
               dict(module='hey', dashboard=dict(status='ready', countMore='true'))]
    invalid.extend(dict(module='clock', dashboard=dict(status='ready', time=value, weekday='Wed'))
                   for value in [None, True, '', '24:00', '12:60am', '05:20pm', '13:20pm', '5:20PM'])
    invalid.extend(dict(module='clock', dashboard=dict(status='ready', time='5:20pm', weekday=value))
                   for value in [None, True, 'wed', 'Wednesday', 'Xxx'])
    invalid.extend(dict(module='hey', dashboard=dict(status='ready', items=items)) for items in [
        None, {}, [None], [{}], [dict(sender='Alex')], [dict(subject='Hello')],
        [dict(sender=True, subject='Hello')], [dict(sender='Alex', subject=None)],
        [dict(sender='x' * 33, subject='Hello')], [dict(sender='Alex', subject='x' * 65)],
        [dict(sender='\u00e9' * 17, subject='Hello')],
        [dict(sender='Alex', subject='Hello')] * 4,
    ])
    invalid.extend(dict(module='usage', dashboard=dict(status='ready', **paging)) for paging in [
        dict(pageIndex=0), dict(pageCount=1), dict(pageIndex=0, pageCount=0),
        dict(pageIndex=0, pageCount=257), dict(pageIndex=256, pageCount=256),
        dict(pageIndex=-1, pageCount=2), dict(pageIndex=0.5, pageCount=2),
        dict(pageIndex=0, pageCount=1.5), dict(pageIndex='0', pageCount=2),
        dict(pageIndex=0, pageCount=True), dict(pageIndex=None, pageCount=1),
    ])
    invalid.extend(dict(module='usage', dashboard=dict(status='ready', refreshing=refreshing))
                   for refreshing in [None, 'true', 1, 0, [], {}])
    invalid.extend(dict(module='usage', showCardBackgrounds=backgrounds)
                   for backgrounds in [None, 'true', 1, 0, [], {}])
    for extra in invalid:
        seq += 2
        rejected = (json.dumps(dict(base, seq=seq - 1, **extra)) + '\n').encode()
        barrier = (json.dumps(dict(base, seq=seq)) + '\n').encode()
        # A valid frame's ACK paces the test within the 4096-byte receive buffer.
        assert len(rejected) + len(barrier) <= 4096
        device.write(rejected)
        device.write(barrier)
        message = receive(lambda item: item.get('type') == 'ack')
        assert message.get('seq') == seq, message
    drawn = render()
    assert drawn.get('module') == 'face' and drawn.get('shimmer_pixels', 0) > 100, drawn
    assert drawn.get('page_index') == 0 and drawn.get('page_count') == 1, drawn
    print('PASS: invalid module frames are ignored; legacy face frames recover', flush=True)
