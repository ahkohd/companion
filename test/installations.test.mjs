import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Installations } from '../bridge/installations.mjs'
import { run } from '../scripts/companion.mjs'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'companion-install-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const root = join(home, 'app with spaces')
  await mkdir(join(root, 'skills', 'companion-attention'), { recursive: true })
  await writeFile(join(root, 'skills', 'companion-attention', 'SKILL.md'), 'version one')

  return { home, root, service: new Installations({ home, root }) }
}

test('skills install offline, update, preserve edits and uninstall', async (t) => {
  const { service, root } = await fixture(t)

  assert.equal((await service.snapshot()).skills.items[0].status, 'missing')

  let state = await service.change({ action: 'skills.installAll' })
  const file = join(state.skills.items[0].path, 'SKILL.md')

  assert.equal(state.skills.items[0].status, 'installed')

  await writeFile(join(root, 'skills', 'companion-attention', 'SKILL.md'), 'version two')

  assert.equal((await service.snapshot()).skills.items[0].status, 'outdated')

  await service.change({ action: 'skills.install', name: 'companion-attention' })

  assert.equal(await readFile(file, 'utf8'), 'version two')

  await writeFile(file, 'my custom version')

  assert.equal((await service.snapshot()).skills.items[0].status, 'modified')
  await assert.rejects(
    service.change({ action: 'skills.install', name: 'companion-attention' }),
    /Preserving modified/,
  )
  await assert.rejects(
    service.change({ action: 'skills.uninstall', name: 'companion-attention' }),
    /Preserving modified/,
  )
  assert.equal(await readFile(file, 'utf8'), 'my custom version')

  await writeFile(file, 'version two')
  state = await service.change({ action: 'skills.uninstall', name: 'companion-attention' })

  assert.equal(state.skills.items[0].status, 'missing')
})

test('custom directory persists and target symlinks/unmanaged files are preserved', async (t) => {
  const { service, home, root } = await fixture(t)
  const real = join(home, 'dotfiles', 'skills')
  await mkdir(real, { recursive: true })

  await symlink(real, join(home, 'linked'))
  await service.change({ action: 'skills.directory', directory: '~/linked' })
  const external = join(root, 'skills', 'companion-attention')
  await symlink(external, join(real, 'companion-attention'))

  assert.equal((await service.snapshot()).skills.items[0].status, 'conflict')
  await assert.rejects(
    service.change({ action: 'skills.uninstall', name: 'companion-attention' }),
    /Preserving conflict/,
  )
  assert.equal(await readFile(join(external, 'SKILL.md'), 'utf8'), 'version one')

  const reopened = new Installations({ home, root })

  assert.equal((await reopened.snapshot()).skills.directory, join(home, 'linked'))

  await rm(join(real, 'companion-attention'))

  assert.equal(
    (await reopened.change({ action: 'skills.installAll' })).skills.items[0].status,
    'installed',
  )

  await writeFile(join(real, 'companion-attention', 'personal.txt'), 'keep')

  await assert.rejects(
    reopened.change({ action: 'skills.uninstall', name: 'companion-attention' }),
    /Preserving modified/,
  )
})

test('CLI wrapper uses explicit quoted paths and preserves modifications', async (t) => {
  const { service, home } = await fixture(t)
  let state = await service.change({ action: 'cli.install' })

  assert.equal(state.cli.status, 'installed')

  const content = await readFile(state.cli.path, 'utf8')

  assert.match(content, /exec '/)
  assert.match(content, /app with spaces\/scripts\/companion.mjs' "\$@"/)

  await chmod(state.cli.path, 0o644)

  assert.equal((await service.snapshot()).cli.status, 'outdated')

  await service.change({ action: 'cli.install' })
  await writeFile(state.cli.path, 'custom')

  await assert.rejects(service.change({ action: 'cli.uninstall' }), /Preserving modified/)

  await writeFile(state.cli.path, content)
  state = await service.change({ action: 'cli.uninstall' })

  assert.equal(state.cli.status, 'missing')

  await writeFile(join(home, '.local', 'bin', 'companion'), 'existing')

  await assert.rejects(service.change({ action: 'cli.install' }), /Preserving conflict/)
})

test('skills CLI list, path, install and uninstall run without bridge', async (t) => {
  const { service, home } = await fixture(t)
  const output = []
  const deps = {
    installations: service,

    out: (x) => output.push(x),

    fetcher: () => {
      throw new Error('must stay offline')
    },
  }

  assert.equal(await run(['skills'], deps), 0)
  assert.equal(output.pop().items[0].status, 'missing')

  await run(['skills', 'install', '--all', '--directory', join(home, 'custom')], deps)

  assert.equal(output.pop().items[0].status, 'installed')

  await run(['skills', 'path', 'companion-attention'], deps)

  assert.equal(output.pop(), await realpath(join(home, 'custom', 'companion-attention')))

  await run(['skills', 'uninstall', 'companion-attention'], deps)

  assert.equal(output.pop().items[0].status, 'missing')
  await assert.rejects(run(['skills', 'install'], deps), /Use skills/)
  await assert.rejects(run(['skills', 'path', 'unknown'], deps), /Unknown skill/)
  await assert.rejects(run(['skills', '--directory'], deps), /requires a path/)
  await assert.rejects(
    service.change({ action: 'skills.directory', directory: 'relative' }),
    /absolute/,
  )
})

test('empty directories count as modifications and malformed ownership is rejected', async (t) => {
  const { service, home } = await fixture(t)
  const state = await service.change({ action: 'skills.installAll' })
  await mkdir(join(state.skills.items[0].path, 'personal-empty'))

  assert.equal((await service.snapshot()).skills.items[0].status, 'modified')
  await assert.rejects(
    service.change({ action: 'skills.uninstall', name: 'companion-attention' }),
    /modified/,
  )
  assert.equal(await readFile(join(state.skills.items[0].path, 'SKILL.md'), 'utf8'), 'version one')

  const configPath = join(home, '.config', 'companion', 'installations.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.managed[state.skills.items[0].path]['../unrelated'] = 'a'.repeat(64)
  await writeFile(configPath, JSON.stringify(config))

  await assert.rejects(service.snapshot(), /ownership path/)
})

test('failed settings write rolls an update back to working installed files', async (t) => {
  const { service, root } = await fixture(t)
  const state = await service.change({ action: 'skills.installAll' })
  await writeFile(join(root, 'skills', 'companion-attention', 'SKILL.md'), 'replacement')
  service.save = async () => {
    throw new Error('disk write failed')
  }

  await assert.rejects(service.change({ action: 'skills.installAll' }), /disk write failed/)
  assert.equal(await readFile(join(state.skills.items[0].path, 'SKILL.md'), 'utf8'), 'version one')
  assert.equal((await service.snapshot()).skills.items[0].status, 'outdated')
})

test('recovers a crashed installer lock without taking over an active installer', async (t) => {
  const { service, home } = await fixture(t)
  const { spawnSync } = await import('node:child_process')
  const dead = spawnSync(process.execPath, ['-e', ''])
  const lock = join(home, '.config', 'companion', 'installations.lock')
  await mkdir(lock, { recursive: true })
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: dead.pid }))

  assert.equal(
    (await service.change({ action: 'skills.installAll' })).skills.items[0].status,
    'installed',
  )

  await mkdir(lock)
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))

  await assert.rejects(
    service.change({ action: 'skills.uninstall', name: 'companion-attention' }),
    /in progress/,
  )
})
