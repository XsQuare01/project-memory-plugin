import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { makePmRoot, makeUserRepo, write, git } from './helpers.mjs'
import { beginJournal, rollback, recoverPending, pendingJournals } from '../lib/journal.mjs'

const K = 'projects/p/knowledge'

function seeded() {
  const root = makePmRoot()
  write(root, `${K}/a.md`, 'A0\n')
  write(root, `${K}/gone.md`, 'G0\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'seed')
  return root
}

test('되돌리기: 수정은 원래 내용으로, 새 파일은 삭제, 지운 파일은 복원', () => {
  const root = seeded()
  const j = beginJournal(root, 'tx1', { files: [`${K}/a.md`, `${K}/new.md`, `${K}/gone.md`] })
  write(root, `${K}/a.md`, 'A1\n')
  write(root, `${K}/new.md`, 'N\n')
  rmSync(join(root, `${K}/gone.md`))
  rollback(root, j)
  assert.equal(readFileSync(join(root, `${K}/a.md`), 'utf8'), 'A0\n')
  assert.equal(existsSync(join(root, `${K}/new.md`)), false)
  assert.equal(readFileSync(join(root, `${K}/gone.md`), 'utf8'), 'G0\n')
  assert.deepEqual(pendingJournals(root), [])
})

test('되돌리기: git add 된 변경도 스테이징에서 빠진다(새 파일 포함)', () => {
  const root = seeded()
  const j = beginJournal(root, 'tx2', { files: [`${K}/a.md`, `${K}/new.md`] })
  write(root, `${K}/a.md`, 'A1\n')
  write(root, `${K}/new.md`, 'N\n')
  git(root, 'add', '--', `${K}/a.md`, `${K}/new.md`)
  rollback(root, j)
  assert.equal(git(root, 'diff', '--cached', '--name-only'), '')
  assert.equal(git(root, 'status', '--porcelain'), '')
})

test('되돌리기: 외부 저장소의 그 설정 키만 되돌린다(이전에 없던 키는 지우고, 다른 키는 그대로)', () => {
  const root = seeded()
  const user = makeUserRepo()
  const commonDir = join(user, '.git')
  git(user, 'config', 'branch.feat/x.pm-project', 'old')
  git(user, 'config', 'pm-test.other', 'keep')
  const j = beginJournal(root, 'tx3', {
    files: [],
    gitConfig: [{ commonDir, key: 'branch.feat/x.pm-project' }, { commonDir, key: 'branch.feat/y.pm-project' }],
  })
  git(user, 'config', 'branch.feat/x.pm-project', 'new')
  git(user, 'config', 'branch.feat/y.pm-project', 'new')
  git(user, 'config', 'pm-test.other', 'changed-by-someone-else')
  rollback(root, j)
  assert.equal(git(user, 'config', '--get', 'branch.feat/x.pm-project').trim(), 'old')
  assert.throws(() => git(user, 'config', '--get', 'branch.feat/y.pm-project'))
  assert.equal(git(user, 'config', '--get', 'pm-test.other').trim(), 'changed-by-someone-else')
})

test('되돌리기를 두 번 실행해도 결과가 같다', () => {
  const root = seeded()
  const user = makeUserRepo()
  const j = beginJournal(root, 'tx4', { files: [`${K}/a.md`, `${K}/new.md`], gitConfig: [{ commonDir: join(user, '.git'), key: 'branch.main.pm-project' }] })
  write(root, `${K}/a.md`, 'A1\n')
  write(root, `${K}/new.md`, 'N\n')
  git(user, 'config', 'branch.main.pm-project', 'p')
  rollback(root, j)
  rollback(root, j)
  assert.equal(readFileSync(join(root, `${K}/a.md`), 'utf8'), 'A0\n')
  assert.equal(existsSync(join(root, `${K}/new.md`)), false)
  assert.throws(() => git(user, 'config', '--get', 'branch.main.pm-project'))
})

test('재시작 복구: Tx 커밋이 있으면 되돌리지 않고 정리만 한다', () => {
  const root = seeded()
  beginJournal(root, 'txdone', { files: [`${K}/a.md`], meta: { agent: 'claude', session: 's' } })
  write(root, `${K}/a.md`, 'A1\n')
  git(root, 'add', '--', `${K}/a.md`)
  git(root, 'commit', '-q', '-m', 'change', '--trailer', 'Tx: txdone')
  const committed = []
  const result = recoverPending(root, { onCommitted: j => committed.push(j.txId) })
  assert.deepEqual(result, { rolledBack: [], committed: ['txdone'] })
  assert.deepEqual(committed, ['txdone'])
  assert.equal(readFileSync(join(root, `${K}/a.md`), 'utf8'), 'A1\n')
  assert.deepEqual(pendingJournals(root), [])
})

test('재시작 복구: Tx 커밋이 없으면 되돌린다', () => {
  const root = seeded()
  beginJournal(root, 'txcrash', { files: [`${K}/a.md`] })
  write(root, `${K}/a.md`, 'A1\n')
  git(root, 'add', '--', `${K}/a.md`)
  const result = recoverPending(root)
  assert.deepEqual(result, { rolledBack: ['txcrash'], committed: [] })
  assert.equal(readFileSync(join(root, `${K}/a.md`), 'utf8'), 'A0\n')
  assert.equal(git(root, 'status', '--porcelain'), '')
})
