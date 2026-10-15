import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makePmRoot } from './helpers.mjs'
import { acquireLock, releaseLock, forceUnlock, pidAlive, claimDir } from '../lib/lock.mjs'

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lock-child.mjs')
const lockDir = root => join(root, 'runtime', 'lock')
const reclaimDir = root => join(root, 'runtime', 'lock.reclaim')
const owner = { agent: 'test', session: 's1' }

function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid
}

function plantLock(dir, content) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'owner.json'), content)
}

test('잡고 풀면 잠금 폴더가 사라진다', () => {
  const root = makePmRoot()
  const { token } = acquireLock(root, owner)
  assert.ok(existsSync(join(lockDir(root), 'owner.json')))
  releaseLock(root, token)
  assert.equal(existsSync(lockDir(root)), false)
})

test('다른 토큰으로는 풀 수 없다', () => {
  const root = makePmRoot()
  acquireLock(root, owner)
  assert.throws(() => releaseLock(root, 'not-mine'), /소유자/)
  assert.ok(existsSync(lockDir(root)))
})

test('살아 있는 소유자가 잡고 있으면 시간 안에 못 잡고 실패한다', () => {
  const root = makePmRoot()
  acquireLock(root, owner)
  assert.throws(() => acquireLock(root, owner, { timeoutMs: 300 }), /잠금/)
})

test('소유자 프로세스가 죽은 잠금은 회수하고 잡는다', () => {
  const root = makePmRoot()
  plantLock(lockDir(root), JSON.stringify({ pid: deadPid(), token: 'old' }))
  const { token } = acquireLock(root, owner, { timeoutMs: 2000 })
  assert.ok(token)
  assert.equal(existsSync(reclaimDir(root)), false)
})

test('owner.json 이 깨진 잠금은 지우지 않고 실패한다', () => {
  const root = makePmRoot()
  plantLock(lockDir(root), '{깨짐')
  assert.throws(() => acquireLock(root, owner, { timeoutMs: 300 }), /판정/)
  assert.ok(existsSync(lockDir(root)))
})

test('생존을 판정할 수 없는 소유자의 잠금은 지우지 않는다', () => {
  const root = makePmRoot()
  plantLock(lockDir(root), JSON.stringify({ pid: 12345, token: 'x' }))
  assert.throws(() => acquireLock(root, owner, { timeoutMs: 300, isAlive: () => 'unknown' }), /판정/)
  assert.ok(existsSync(lockDir(root)))
})

test('회수 작업이 죽어 남은 lock.reclaim 은 자동으로 지우지 않고, unlock --force 가 둘 다 푼다', () => {
  const root = makePmRoot()
  plantLock(lockDir(root), JSON.stringify({ pid: deadPid(), token: 'old' }))
  plantLock(reclaimDir(root), JSON.stringify({ pid: deadPid(), token: 'r' }))
  assert.throws(() => acquireLock(root, owner, { timeoutMs: 300 }), /회수/)
  assert.ok(existsSync(reclaimDir(root)))
  forceUnlock(root)
  assert.equal(existsSync(lockDir(root)), false)
  assert.equal(existsSync(reclaimDir(root)), false)
  const { token } = acquireLock(root, owner, { timeoutMs: 1000 })
  assert.ok(token)
})

test('Windows 에서 지워지는 중인 잠금 폴더로의 이름 바꾸기 EPERM 은 "사용 중"으로 보고 다시 시도한다', () => {
  const root = makePmRoot()
  const target = join(root, 'runtime', 'lock')
  mkdirSync(join(root, 'runtime'), { recursive: true })
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const failing = () => { const e = new Error(code); e.code = code; throw e }
    assert.equal(claimDir(target, { token: 't' }, failing), false, code)
  }
  const other = () => { const e = new Error('EIO'); e.code = 'EIO'; throw e }
  assert.throws(() => claimDir(target, { token: 't' }, other), /EIO/)
})

test('pidAlive: 프로세스 없음은 dead, 권한 오류는 alive, 그 밖은 unknown', () => {
  const thrower = code => () => { const e = new Error(code); e.code = code; throw e }
  assert.equal(pidAlive(1, thrower('ESRCH')), 'dead')
  assert.equal(pidAlive(1, thrower('EPERM')), 'alive')
  assert.equal(pidAlive(1, thrower('EINVAL')), 'unknown')
  assert.equal(pidAlive(1, () => true), 'alive')
  assert.equal(pidAlive('x', () => true), 'unknown')
  assert.equal(pidAlive(process.pid), 'alive')
  assert.equal(pidAlive(deadPid()), 'dead')
})

test('두 프로세스가 같은 죽은 잠금을 동시에 회수해도 서로의 새 잠금을 지우지 않는다', async () => {
  const root = makePmRoot()
  plantLock(lockDir(root), JSON.stringify({ pid: deadPid(), token: 'old' }))
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, root, '600'])
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('close', code => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))))
  })
  const results = await Promise.all([run(), run(), run()])
  assert.deepEqual(results.map(r => r.ok), [true, true, true])
  assert.equal(existsSync(lockDir(root)), false)
})
