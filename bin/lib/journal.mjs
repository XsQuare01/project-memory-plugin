// 작업 기록과 되돌리기 (설계 6.4·6.6).
// 쓰기 전에 대상 파일의 원래 내용과 바꿀 외부 git 설정 키의 이전 값을 남긴다. 일반 실패와 강제 종료 뒤 재시작이
// 같은 rollback 을 쓰고, rollback 은 여러 번 실행해도 결과가 같다. 경계는 작업 커밋(Tx 꼬리표)이다.
import { mkdirSync, writeFileSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.mjs'
import { atomicWrite, readIfExists, readJson } from './fsx.mjs'

const journalRoot = root => join(root, 'runtime', 'journal')

function configGet(commonDir, key) {
  const r = git(commonDir, ['config', '--file', join(commonDir, 'config'), '--get', key], { allowFail: true })
  return r.status === 0 ? r.stdout.toString('utf8').replace(/\r?\n$/, '') : null
}

function configRestore(commonDir, key, previous) {
  const file = join(commonDir, 'config')
  if (previous === null) git(commonDir, ['config', '--file', file, '--unset-all', key], { allowFail: true })
  else git(commonDir, ['config', '--file', file, key, previous])
}

/**
 * 작업 기록을 만든다. 원래 내용 사본을 임시 폴더에 다 쓴 뒤 이름 바꾸기로 드러내므로,
 * 기록 폴더가 보이면 언제나 완전하다.
 * files: 저장소 상대 경로 목록. gitConfig: [{ commonDir, key }]. meta: 정리할 때 쓸 정보(세션 등).
 */
export function beginJournal(root, txId, { files = [], gitConfig = [], meta = {} } = {}) {
  const base = journalRoot(root)
  const tmp = join(base, `${txId}.tmp`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(join(tmp, 'files'), { recursive: true })
  const entries = files.map((path, i) => {
    const original = readIfExists(join(root, path))
    if (original !== null) writeFileSync(join(tmp, 'files', String(i)), original)
    return { path, existed: original !== null, backup: original !== null ? String(i) : null }
  })
  const configs = gitConfig.map(({ commonDir, key }) => ({ commonDir, key, previous: configGet(commonDir, key) }))
  const journal = { txId, created: new Date().toISOString(), files: entries, gitConfig: configs, meta }
  writeFileSync(join(tmp, 'journal.json'), JSON.stringify(journal, null, 2))
  renameSync(tmp, join(base, txId))
  return journal
}

/** 되돌리기 절차: 파일 → 스테이징 → 외부 설정 키 → 기록 삭제. 변경안·기준본은 건드리지 않는다. */
export function rollback(root, journal) {
  const dir = join(journalRoot(root), journal.txId)
  for (const entry of journal.files) {
    const target = join(root, entry.path)
    if (entry.existed) {
      const backup = readIfExists(join(dir, 'files', entry.backup))
      if (backup === null) {
        // 앞선 rollback 이 이미 끝까지 갔다면 기록 폴더가 없다. 그때는 파일도 이미 되돌려져 있다.
        if (existsSync(dir)) throw new Error(`작업 기록 ${journal.txId} 의 사본 ${entry.backup} 이 없습니다`)
        continue
      }
      atomicWrite(target, backup)
    } else {
      rmSync(target, { force: true })
    }
  }
  const paths = journal.files.map(f => f.path)
  if (paths.length) {
    const r = git(root, ['reset', '-q', '--', ...paths], { allowFail: true })
    // HEAD 가 아직 없는 저장소에서는 reset 이 실패한다. 그때는 스테이징에서 직접 뺀다.
    if (r.status !== 0) git(root, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...paths], { allowFail: true })
  }
  for (const { commonDir, key, previous } of journal.gitConfig) configRestore(commonDir, key, previous)
  rmSync(dir, { recursive: true, force: true })
}

export function pendingJournals(root) {
  const base = journalRoot(root)
  if (!existsSync(base)) return []
  const out = []
  for (const name of readdirSync(base)) {
    if (name.endsWith('.tmp')) {
      // 기록을 다 쓰기 전에 죽은 흔적. 아직 아무 파일도 바꾸지 않았으므로 지우기만 한다.
      rmSync(join(base, name), { recursive: true, force: true })
      continue
    }
    const journal = readJson(join(base, name, 'journal.json'), null)
    if (journal) out.push(journal)
  }
  return out
}

export function isCommitted(root, txId) {
  const r = git(root, ['log', '-1', '--format=%H', '-F', `--grep=Tx: ${txId}`], { allowFail: true })
  return r.status === 0 && r.stdout.toString('utf8').trim() !== ''
}

/** 남은 작업 기록을 처리한다. 커밋된 작업은 정리만, 아니면 되돌린다. */
export function recoverPending(root, { onCommitted } = {}) {
  const result = { rolledBack: [], committed: [] }
  for (const journal of pendingJournals(root)) {
    if (isCommitted(root, journal.txId)) {
      onCommitted?.(journal)
      rmSync(join(journalRoot(root), journal.txId), { recursive: true, force: true })
      result.committed.push(journal.txId)
    } else {
      rollback(root, journal)
      result.rolledBack.push(journal.txId)
    }
  }
  return result
}
