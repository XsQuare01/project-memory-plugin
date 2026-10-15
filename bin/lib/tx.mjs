// 쓰기 트랜잭션 (설계 6.4·6.6): 잠금 → 남은 작업 기록 복구 → 작업 기록 → 외부 설정·파일 쓰기 → git add → 커밋.
// 커밋 전 어느 단계에서 실패해도 같은 되돌리기 절차로 원래 상태가 된다.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { PmError } from './errors.mjs'
import { git, gitText } from './git.mjs'
import { atomicWrite, randomToken } from './fsx.mjs'
import { acquireLock, releaseLock } from './lock.mjs'
import { beginJournal, rollback, recoverPending, pendingJournals } from './journal.mjs'
import { dropDrafts } from './drafts.mjs'
import { ensureDataRoot } from './root.mjs'

/** 테스트 전용 고장 주입. PM_TEST_FAULT 가 이 지점 이름이면 강제 종료(또는 커밋 실패)를 흉내 낸다. */
export function fault(name) {
  if (process.env.PM_TEST_FAULT !== name) return
  if (name === 'commit-fail' || name === 'write-2-fail') throw new Error(`PM_TEST_FAULT ${name}`)
  process.exit(137)
}

function cleanupCommitted(root, journal) {
  const { agent, session } = journal.meta ?? {}
  if (agent && session) dropDrafts(root, agent, session, journal.files.map(f => f.path))
}

/** 잠금 안에서 fn 을 실행한다. 잡은 직후 남은 작업 기록부터 처리한다(복구 전에는 아무것도 쓰지 않는다). */
export function withLock(root, owner, fn, lockOptions) {
  ensureDataRoot(root)
  const { token } = acquireLock(root, owner, lockOptions)
  try {
    recoverPending(root, { onCommitted: j => cleanupCommitted(root, j) })
    return fn()
  } finally {
    releaseLock(root, token)
  }
}

/** 남은 작업 기록이 있을 때만 잠금을 잡고 복구한다. 잠금 없이 읽고 쓰는 명령(checkout 등)이 먼저 부른다. */
export function recoverIfPending(root, owner = { agent: 'pm', session: 'recover' }) {
  if (pendingJournals(root).length) withLock(root, owner, () => {})
}

function ignoredOf(root, paths) {
  if (!paths.length) return new Set()
  const r = git(root, ['check-ignore', '-z', '--stdin'], { input: paths.join('\0'), allowFail: true })
  return new Set(r.stdout.toString('utf8').split('\0').filter(Boolean))
}

function setConfig(commonDir, key, value) {
  const file = join(commonDir, 'config')
  if (value === null) git(commonDir, ['config', '--file', file, '--unset-all', key], { allowFail: true })
  else git(commonDir, ['config', '--file', file, key, value])
}

/**
 * 잠금 안에서 부른다. files: [{ path(저장소 상대), data: Buffer | null(삭제) }],
 * gitConfig: [{ commonDir, key, value | null(삭제) }], trailers: { 이름: 값 }.
 */
export function commitTx(root, { files, gitConfig = [], message, trailers = {}, meta = {} }) {
  const txId = `${Date.now().toString(36)}-${randomToken().slice(0, 8)}`
  const paths = files.map(f => f.path)
  // .gitignore 대상(바이너리 자료)은 디스크에만 쓰고 커밋하지 않는다. 작업 기록에는 들어가 실패하면 지워진다.
  const ignored = ignoredOf(root, paths)
  const tracked = paths.filter(p => !ignored.has(p))
  const journal = beginJournal(root, txId, { files: paths, gitConfig, meta })
  try {
    fault('after-journal')
    for (const { commonDir, key, value } of gitConfig) setConfig(commonDir, key, value)
    files.forEach((f, i) => {
      if (i === 1) fault('write-2-fail')
      if (f.data === null) rmSync(join(root, f.path), { force: true })
      else atomicWrite(join(root, f.path), f.data)
      if (i === 0) fault('after-write-1')
    })
    if (tracked.length) {
      git(root, ['add', '-A', '--', ...tracked])
      fault('after-add')
      fault('commit-fail')
      const args = ['commit', '-q', '-m', message]
      for (const [k, v] of Object.entries({ ...trailers, Tx: txId })) args.push('--trailer', `${k}: ${v}`)
      git(root, [...args, '--', ...tracked])
    }
  } catch (err) {
    try {
      rollback(root, journal)
    } catch (again) {
      throw new PmError(`실패한 뒤 되돌리기도 실패했습니다 — pm recover 로 확인하세요. 되돌리기 오류: ${again.message} / 원래 오류: ${err.message}`)
    }
    throw err
  }
  if (tracked.length) fault('after-commit')
  rmSync(join(root, 'runtime', 'journal', txId), { recursive: true, force: true })
  return { txId, commit: tracked.length ? gitText(root, ['rev-parse', 'HEAD']).trim() : null }
}
