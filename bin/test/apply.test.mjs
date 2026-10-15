import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { makePmRoot, write, git } from './helpers.mjs'
import { seedProject, docs, P } from './fixtures/seed.mjs'
import { checkout, refresh, readManifest } from '../lib/drafts.mjs'
import { apply } from '../lib/apply.mjs'
import { sha256 } from '../lib/fsx.mjs'

const S = { agent: 'claude', session: 'sess-1' }
const base = { ...S, project: 'p' }
const read = (root, rel) => readFileSync(join(root, rel), 'utf8')

function setup() {
  return seedProject(makePmRoot())
}

function edit(root, rel, fn) {
  const [entry] = checkout(root, { ...base, paths: [rel] })
  writeFileSync(entry.draftPath, fn(readFileSync(entry.draftPath, 'utf8')))
  return entry
}

// ---- checkout ----

test('checkout: 기준본과 변경안을 만들고, 기준 해시는 기준본 바이트의 해시', () => {
  const root = setup()
  const [e] = checkout(root, { ...base, paths: ['knowledge/rail.md'] })
  assert.equal(read(root, `${P}/knowledge/rail.md`), readFileSync(e.draftPath, 'utf8'))
  const m = readManifest(root, S.agent, S.session)[`${P}/knowledge/rail.md`]
  assert.equal(m.mode, 'edit')
  assert.equal(m.baseHash, sha256(readFileSync(e.basePath)))
})

test('checkout: 커밋 안 된 정본·추적 안 된 파일은 거부', () => {
  const root = setup()
  write(root, `${P}/knowledge/rail.md`, 'dirty\n')
  assert.throws(() => checkout(root, { ...base, paths: ['knowledge/rail.md'] }), /커밋 안 된/)
  write(root, `${P}/knowledge/untracked.md`, 'x\n')
  assert.throws(() => checkout(root, { ...base, paths: ['knowledge/untracked.md'], mode: 'new' }), /커밋 안 된|이미 있/)
})

test('checkout: sources/ 와 문서가 아닌 경로, 같은 경로 두 번은 거부', () => {
  const root = setup()
  assert.throws(() => checkout(root, { ...base, paths: ['sources/meshes/source.json'] }), /sources/)
  assert.throws(() => checkout(root, { ...base, paths: ['notes.txt'], mode: 'new' }), /문서/)
  checkout(root, { ...base, paths: ['knowledge/rail.md'] })
  assert.throws(() => checkout(root, { ...base, paths: ['knowledge/rail.md'] }), /refresh/)
})

// ---- apply ----

test('apply: 정본에 쓰고 그 경로만 커밋하며 꼬리표 다섯 개를 남긴다', () => {
  const root = setup()
  write(root, 'unrelated.txt', 'staged by user\n')
  git(root, 'add', 'unrelated.txt')
  edit(root, 'knowledge/rail.md', t => t.replace('첫 줄', '고친 첫 줄'))
  const r = apply(root, { ...base, message: '레일 구조 보충', via: 'use' })
  assert.match(read(root, `${P}/knowledge/rail.md`), /고친 첫 줄/)
  const trailers = git(root, 'log', '-1', '--format=%(trailers:only,unfold)')
  for (const t of ['Project: p', 'Agent: claude', 'Session: sess-1', 'Via: use', `Tx: ${r.txId}`]) assert.match(trailers, new RegExp(t))
  assert.deepEqual(git(root, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n'), [`${P}/knowledge/rail.md`])
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), 'unrelated.txt')
  assert.deepEqual(readManifest(root, S.agent, S.session), {})
})

test('apply: 정본이 기준과 다르면 아무것도 쓰지 않고 충돌(종료 코드 3)과 diff 를 낸다', () => {
  const root = setup()
  const e = edit(root, 'knowledge/rail.md', t => t.replace('첫 줄', '내 변경'))
  write(root, `${P}/knowledge/rail.md`, docs.proposed.replace('셋째 줄', '남의 변경'))
  git(root, 'commit', '-q', '-am', 'other session')
  const head = git(root, 'rev-parse', 'HEAD')
  assert.throws(() => apply(root, { ...base, message: 'm' }), err => err.code === 3 && /남의 변경/.test(err.message))
  assert.equal(git(root, 'rev-parse', 'HEAD'), head)
  assert.match(read(root, `${P}/knowledge/rail.md`), /남의 변경/)
  assert.ok(existsSync(e.draftPath) && existsSync(e.basePath))
})

test('apply: 새 파일, 그리고 그사이 남이 같은 파일을 만들면 충돌', () => {
  const root = setup()
  const [e] = checkout(root, { ...base, paths: ['questions/new-q.md'], mode: 'new' })
  writeFileSync(e.draftPath, docs.question.replace('수동 레일 정지', '새 질문'))
  apply(root, { ...base, message: '질문 추가' })
  assert.match(read(root, `${P}/questions/new-q.md`), /새 질문/)

  const [e2] = checkout(root, { ...base, paths: ['questions/race.md'], mode: 'new' })
  writeFileSync(e2.draftPath, docs.question)
  write(root, `${P}/questions/race.md`, docs.question)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'someone else')
  assert.throws(() => apply(root, { ...base, message: 'm' }), err => err.code === 3)
})

test('apply: 삭제', () => {
  const root = setup()
  checkout(root, { ...base, paths: ['questions/manual-stop.md'], mode: 'delete' })
  apply(root, { ...base, message: '질문 삭제' })
  assert.equal(existsSync(join(root, `${P}/questions/manual-stop.md`)), false)
  assert.equal(git(root, 'status', '--porcelain'), '')
})

test('apply: 다른 프로젝트의 변경안은 거부', () => {
  const root = setup()
  edit(root, 'knowledge/rail.md', t => t.replace('첫 줄', 'x'))
  assert.throws(() => apply(root, { ...S, project: 'other', message: 'm' }), /프로젝트/)
})

test('apply: 머리말 오류·충돌 표시·없는 근거는 거부', () => {
  const root = setup()
  edit(root, 'knowledge/rail.md', t => t.replace('status: proposed', 'status: maybe'))
  assert.throws(() => apply(root, { ...base, message: 'm' }), /status/)

  const r2 = setup()
  edit(r2, 'knowledge/rail.md', t => `${t}<<<<<<< 내변경안\na\n=======\nb\n>>>>>>> 현재정본\n`)
  assert.throws(() => apply(r2, { ...base, message: 'm' }), /충돌 표시/)

  const r3 = setup()
  edit(r3, 'knowledge/rail.md', t => t.replace('meshes@2026-10-11-aaaaaaaa', 'meshes@2026-01-01-bbbbbbbb'))
  assert.throws(() => apply(r3, { ...base, message: 'm' }), /근거/)

  const r4 = setup()
  edit(r4, 'knowledge/rail.md', t => t.replace('  - source: meshes@2026-10-11-aaaaaaaa', '  - decision: 2026-10-07-k3.md'))
  apply(r4, { ...base, message: '근거를 결정으로' })
})

test('apply: 변경안이 정본과 같으면 커밋하지 않고 정리만', () => {
  const root = setup()
  checkout(root, { ...base, paths: ['knowledge/rail.md'] })
  const head = git(root, 'rev-parse', 'HEAD')
  const r = apply(root, { ...base, message: 'm' })
  assert.equal(r.txId, null)
  assert.equal(git(root, 'rev-parse', 'HEAD'), head)
  assert.deepEqual(readManifest(root, S.agent, S.session), {})
})

// ---- confirmed 보호 ----

const confirmedCases = {
  '기존 confirmed 수정': root => edit(root, 'knowledge/mesh.md', t => t.replace('확정 본문', '고친 본문')),
  'confirmed 신규 작성': root => {
    const [e] = checkout(root, { ...base, paths: ['knowledge/new.md'], mode: 'new' })
    writeFileSync(e.draftPath, docs.confirmed)
  },
  'proposed → confirmed 승격': root => edit(root, 'knowledge/rail.md', t => t.replace('status: proposed', 'status: confirmed')),
  'confirmed 삭제': root => checkout(root, { ...base, paths: ['knowledge/mesh.md'], mode: 'delete' }),
}

for (const [name, prepare] of Object.entries(confirmedCases)) {
  test(`confirmed 보호: ${name} — --confirm 없으면 거부, 있으면 통과`, () => {
    const root = setup()
    prepare(root)
    assert.throws(() => apply(root, { ...base, message: 'm' }), /--confirm/)
    apply(root, { ...base, message: 'm', confirm: '사용자가 맞다고 함', today: '2026-10-15' })
    assert.equal(git(root, 'status', '--porcelain'), '')
  })
}

test('confirmed 보호: proposed 끼리의 변경은 --confirm 없이 통과', () => {
  const root = setup()
  edit(root, 'knowledge/rail.md', t => t.replace('첫 줄', '다른 해석'))
  apply(root, { ...base, message: 'm' })
})

test('--confirm 은 evidence 에 user 확인 줄을 붙인다', () => {
  const root = setup()
  edit(root, 'knowledge/rail.md', t => t.replace('status: proposed', 'status: confirmed'))
  apply(root, { ...base, message: '승격', confirm: '레일 구조 맞음', today: '2026-10-15' })
  assert.match(read(root, `${P}/knowledge/rail.md`), /user: 2026-10-15 "레일 구조 맞음"/)
})

// ---- refresh ----

test('refresh: 겹치지 않는 변경은 3방향 병합하고 .prev 를 남기며 다시 apply 할 수 있다', () => {
  const root = setup()
  const e = edit(root, 'knowledge/rail.md', t => t.replace('첫 줄', '내 첫 줄'))
  write(root, `${P}/knowledge/rail.md`, docs.proposed.replace('셋째 줄', '남의 셋째 줄'))
  git(root, 'commit', '-q', '-am', 'other')
  const [r] = refresh(root, { ...base, paths: ['knowledge/rail.md'] })
  assert.equal(r.conflicted, false)
  const merged = readFileSync(e.draftPath, 'utf8')
  assert.match(merged, /내 첫 줄/)
  assert.match(merged, /남의 셋째 줄/)
  assert.ok(existsSync(r.prevDraftPath) && existsSync(r.prevBasePath))
  assert.match(readFileSync(r.prevDraftPath, 'utf8'), /내 첫 줄/)
  apply(root, { ...base, message: '병합 후 반영' })
  assert.match(read(root, `${P}/knowledge/rail.md`), /내 첫 줄[\s\S]*남의 셋째 줄/)
})

test('refresh: 같은 줄을 고쳤으면 충돌 표시가 남고 apply 는 거부한다', () => {
  const root = setup()
  edit(root, 'knowledge/rail.md', t => t.replace('둘째 줄', '내 둘째'))
  write(root, `${P}/knowledge/rail.md`, docs.proposed.replace('둘째 줄', '남의 둘째'))
  git(root, 'commit', '-q', '-am', 'other')
  const [r] = refresh(root, { ...base, paths: ['knowledge/rail.md'] })
  assert.equal(r.conflicted, true)
  assert.throws(() => apply(root, { ...base, message: 'm' }), /충돌 표시/)
})
