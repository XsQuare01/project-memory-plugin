// 전역 쓰기 잠금 (설계 6.7).
// 획득: owner.json 을 넣은 임시 폴더를 lock/ 으로 이름 바꾸기 — 대상이 있으면 실패하므로 동시에 하나만 성공하고,
//       잡힌 잠금에는 언제나 소유자 정보가 있다.
// 회수: 소유자가 확실히 죽은 잠금만, 별도 회수 잠금(lock.reclaim/)을 잡은 상태에서 토큰을 다시 확인한 뒤 지운다.
//       판정할 수 없는 잠금과 남은 회수 잠금은 지우지 않고 실패한다(사용자가 pm unlock --force).
import { mkdirSync, writeFileSync, renameSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PmError } from './errors.mjs'
import { randomToken } from './fsx.mjs'

const runtime = root => join(root, 'runtime')
const LOCK = root => join(runtime(root), 'lock')
const RECLAIM = root => join(runtime(root), 'lock.reclaim')

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 'alive' | 'dead' | 'unknown'. 권한 오류는 프로세스가 있다는 뜻이라 alive 로 본다. */
export function pidAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try {
    kill(pid, 0)
    return 'alive'
  } catch (err) {
    if (err?.code === 'ESRCH') return 'dead'
    if (err?.code === 'EPERM') return 'alive'
    return 'unknown'
  }
}

function readOwner(dir) {
  try {
    const owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
    if (!owner || typeof owner.token !== 'string') return { ok: false, reason: 'owner.json 형식이 깨졌습니다' }
    return { ok: true, owner }
  } catch (err) {
    if (err.code === 'ENOENT' && !existsSync(dir)) return { ok: false, gone: true }
    return { ok: false, reason: `owner.json 을 읽을 수 없습니다(${err.code ?? err.message})` }
  }
}

/** owner.json 을 담은 임시 폴더를 만들어 target 으로 이름 바꾸기를 시도한다. 성공하면 true. */
export function claimDir(target, info, rename = renameSync) {
  const tmp = `${target}.tmp-${randomToken()}`
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(tmp, 'owner.json'), JSON.stringify(info))
  try {
    rename(tmp, target)
    return true
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    // Windows 는 다른 프로세스가 지우는 중인 폴더로 이름을 바꾸면 EPERM(EACCES·EBUSY)을 낸다. 그 순간 대상은
    // 이미 없어 보인다. 잠금 경쟁 중이라는 뜻이므로 "사용 중"으로 보고 다시 시도한다(2026-10-14 부하 실험에서 재현).
    if (existsSync(target) || TRANSIENT.has(err.code)) return false
    throw err
  }
}

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY'])

/** 죽은 소유자의 잠금을 회수 잠금 아래에서 지운다. 결과: 'reclaimed' | 'busy' | 'stale-reclaim' */
function reclaim(root, observedToken, isAlive) {
  const token = randomToken()
  if (!claimDir(RECLAIM(root), { pid: process.pid, token, started: new Date().toISOString() })) {
    const holder = readOwner(RECLAIM(root))
    if (holder.ok && isAlive(holder.owner.pid) === 'alive') return 'busy'
    if (holder.gone) return 'busy'
    return 'stale-reclaim'
  }
  try {
    const now = readOwner(LOCK(root))
    if (now.ok && now.owner.token === observedToken && isAlive(now.owner.pid) === 'dead') {
      rmSync(LOCK(root), { recursive: true, force: true })
      return 'reclaimed'
    }
    return 'busy'
  } finally {
    const mine = readOwner(RECLAIM(root))
    if (mine.ok && mine.owner.token === token) rmSync(RECLAIM(root), { recursive: true, force: true })
  }
}

export function acquireLock(root, info = {}, { timeoutMs = 10000, intervalMs = 200, isAlive = pidAlive } = {}) {
  mkdirSync(runtime(root), { recursive: true })
  const token = randomToken()
  const deadline = Date.now() + timeoutMs
  let lastProblem = null
  for (;;) {
    if (claimDir(LOCK(root), { ...info, pid: process.pid, token, started: new Date().toISOString() })) return { token }

    const seen = readOwner(LOCK(root))
    if (seen.ok) {
      const alive = isAlive(seen.owner.pid)
      if (alive === 'dead') {
        const r = reclaim(root, seen.owner.token, isAlive)
        if (r === 'reclaimed') continue
        if (r === 'stale-reclaim') lastProblem = `회수 작업이 남긴 ${RECLAIM(root)} 가 있습니다 — 확인 후 pm unlock --force`
      } else if (alive === 'unknown') {
        lastProblem = `잠금 소유자(pid ${seen.owner.pid})의 생존을 판정할 수 없습니다`
      } else {
        lastProblem = `잠금을 다른 작업이 쓰고 있습니다(pid ${seen.owner.pid}, ${seen.owner.agent ?? '?'}/${seen.owner.session ?? '?'})`
      }
    } else if (!seen.gone) {
      lastProblem = `잠금 소유자를 판정할 수 없습니다 — ${seen.reason}`
    }

    if (Date.now() >= deadline) {
      throw new PmError(`잠금을 잡지 못했습니다 — ${lastProblem ?? '시간 초과'}. 확인 후 pm unlock --force 로 풀 수 있습니다`)
    }
    sleep(intervalMs)
  }
}

export function releaseLock(root, token) {
  const seen = readOwner(LOCK(root))
  if (!seen.ok || seen.owner.token !== token) throw new PmError('잠금 소유자가 다릅니다 — 풀지 않았습니다')
  rmSync(LOCK(root), { recursive: true, force: true })
}

/** 사용자용. lock/ 과 남은 lock.reclaim/ 을 모두 지운다. */
export function forceUnlock(root) {
  const removed = []
  for (const dir of [LOCK(root), RECLAIM(root)]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    }
  }
  return removed
}
