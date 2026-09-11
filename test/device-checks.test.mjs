import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('hardware checks retain partial serial lines and wait for rendering with a deadline', () => {
  execFileSync(
    'python3',
    [
      '-c',
      String.raw`
import ast, json
from pathlib import Path

class Clock:
    now = 0
    def monotonic(self):
        self.now += .01
        return self.now
    def sleep(self, seconds): self.now += seconds

class Device:
    def __init__(self):
        self.chunks, self.writes, self.stale = [], [], False
        self.pending = self.peak = 0
        self.accept_invalid = False
    def readline(self):
        if not self.chunks: return b''
        self.pending = 0
        return self.chunks.pop(0)
    def write(self, wire):
        self.writes.append(wire)
        self.pending += len(wire)
        self.peak = max(self.peak, self.pending)
        frame = json.loads(wire)
        if frame.get('module') == 'invalid' and not self.accept_invalid: return
        seq = frame['seq']
        drawn = seq - 1 if self.stale or len(self.writes) < 3 else seq
        self.chunks.append(json.dumps(dict(type='ack', seq=seq, rendered_seq=drawn, text_gap=8, status_top=360)).encode() + b'\n')

for filename, receiver, renderer in [('check-device.py', 'receive_until', 'rendered_ack'), ('check-module-device.py', 'receive', 'render')]:
    # Load only the functions under test, without opening a real serial port.
    tree = ast.parse(Path('scripts', filename).read_text())
    functions = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name in (receiver, renderer)]
    device, clock = Device(), Clock()
    scope = dict(device=device, time=clock, incoming=bytearray(), json=json, seq=0, base={})
    exec(compile(ast.Module(body=functions, type_ignores=[]), filename, 'exec'), scope)
    receive = scope[receiver]
    device.chunks = [b'noise\n', b'{"seq":41}\n', b'{"seq":', b'', b'42}', b'\n']
    assert receive(lambda m: m.get('seq') == 42, 3) == {'seq': 42}
    device.chunks = [b'{"seq":42}']
    try: receive(lambda m: True, .1)
    except AssertionError: pass
    else: raise AssertionError('An incomplete line must not be accepted')
    device.chunks = [b'\n']
    assert receive(lambda m: True, 3) == {'seq': 42}
    render = lambda: scope[renderer]({'seq': 42}) if renderer == 'rendered_ack' else scope[renderer]()
    assert render()['rendered_seq'] == (42 if renderer == 'rendered_ack' else 1)
    assert len(device.writes) == 3, device.writes
    assert not device.chunks
    device.stale = True
    start = clock.now
    try: render()
    except AssertionError as error: assert 'rendered_seq' in str(error)
    else: raise AssertionError('An unrendered frame must time out')
    assert clock.now - start < 4
    if filename == 'check-module-device.py':
        loop = next(n for n in ast.walk(tree) if isinstance(n, ast.For) and isinstance(n.iter, ast.Name) and n.iter.id == 'invalid')
        base = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'base' for t in n.targets))
        code = compile(ast.Module(body=[base, loop], type_ignores=[]), filename, 'exec')
        device = Device()
        scope.update(device=device, time=Clock(), incoming=bytearray(), invalid=[{'module': 'invalid'}] * 57)
        exec(code, scope)
        assert len(device.writes) == 114 and not device.chunks
        assert device.peak <= 4096
        device.accept_invalid = True
        try: exec(code, scope)
        except AssertionError: pass
        else: raise AssertionError('An acknowledged invalid frame must fail the check')
`,
    ],
    { stdio: 'pipe' },
  )
})
