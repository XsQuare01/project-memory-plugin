import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, readdirSync, writeFileSync, utimesSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tempDir, runPm, PM, makePmRoot } from './helpers.mjs'
import { validateItem, readItems, remember, editItem, forget, readTombstones, recordMigration, isMigrated } from '../lib/me-store.mjs'

const BY = 'claude/s1'
const base = { id: 'explain-conclusion-first', text: '설명은 결론부터', kind: 'preference', scope: 'global', core: true, source: '2026-10-15 대화 — "앞으로 설명은 결론부터 해줘"' }
const me = () => tempDir('pm-me-')

test('항목 검사: id 규칙, 한 줄 120자, 종류·범위, core 는 global 만', () => {
  const ok = { ...base, confirmed: '2026-10-15', updated: '2026-10-15', revision: 1, updated_by: BY }
  assert.deepEqual(validateItem(ok), [])
  const errs = data => validateItem({ ...ok, ...data }).join('\n')
  assert.match(errs({ id: 'Bad_Id' }), /id/)
  assert.match(errs({ text: '두 줄\n내용' }), /text/)
  assert.match(errs({ text: '가'.repeat(121) }), /text/)
  assert.match(errs({ kind: 'mood' }), /kind/)
  assert.match(errs({ scope: 'team' }), /scope/)
  assert.match(errs({ scope: 'project:acme-paint-cell', core: true }), /core/)
  assert.deepEqual(validateItem({ ...ok, scope: 'company:acme', core: false }), [])
  assert.match(errs({ source: '' }), /source/)
})

test('remember: 판번호 1, 확인일·수정일 오늘, 변경자 기록, 같은 id 는 거부', () => {
  const root = me()
  remember(root, { ...base, by: BY, today: '2026-10-15' })
  const [item] = readItems(root)
  assert.equal(item.data.revision, 1)
  assert.equal(item.data.confirmed, '2026-10-15')
  assert.equal(item.data.updated, '2026-10-15')
  assert.equal(item.data.updated_by, BY)
  assert.throws(() => remember(root, { ...base, by: BY }), /이미/)
})

test('핵심 항목 합계가 600자를 넘게 되는 저장·편집은 거절', () => {
  const root = me()
  for (let i = 0; i < 5; i++) remember(root, { ...base, id: `core-${i}`, text: '가'.repeat(110), by: BY })
  assert.throws(() => remember(root, { ...base, id: 'core-x', text: '나'.repeat(60), by: BY }), /600/)
  remember(root, { ...base, id: 'plain', text: '다'.repeat(60), core: false, by: BY })
  assert.throws(() => editItem(root, { id: 'plain', base: 1, core: true, by: BY }), /600/)
})

test('edit: 판번호가 다르면 거부, 확인일은 그대로 두고 수정일·판번호만 바뀜', () => {
  const root = me()
  remember(root, { ...base, by: BY, today: '2026-10-15' })
  assert.throws(() => editItem(root, { id: base.id, base: 7, kind: 'background', by: BY }), /판번호/)
  editItem(root, { id: base.id, base: 1, kind: 'environment', by: 'claude/s2', today: '2026-10-20' })
  const { data } = readItems(root)[0]
  assert.equal(data.kind, 'environment')
  assert.equal(data.revision, 2)
  assert.equal(data.confirmed, '2026-10-15')
  assert.equal(data.updated, '2026-10-20')
  assert.equal(data.updated_by, 'claude/s2')
})

test('confirm: 확인일을 오늘로, 정정한 text 도 반영', () => {
  const root = me()
  remember(root, { ...base, by: BY, today: '2026-10-15' })
  editItem(root, { id: base.id, base: 1, confirm: true, text: '설명은 결론부터, 근거는 뒤에', source: '2026-10-21 대화 — "근거는 뒤에 붙여줘"', by: BY, today: '2026-10-21' })
  const { data } = readItems(root)[0]
  assert.equal(data.confirmed, '2026-10-21')
  assert.equal(data.text, '설명은 결론부터, 근거는 뒤에')
})

test('forget: 삭제 표시(원문 없음)를 남기고 파일을 지운다', () => {
  const root = me()
  remember(root, { ...base, by: BY })
  forget(root, { id: base.id, by: BY })
  assert.deepEqual(readItems(root), [])
  const [mark] = readTombstones(root)
  assert.equal(mark.id, base.id)
  assert.equal(mark.by, BY)
  assert.doesNotMatch(readFileSync(join(root, 'forgotten', `${base.id}.json`), 'utf8'), /결론부터/)
})

test('forget 도중 종료(표시만 남음): 읽는 쪽은 제외하고, 다음 쓰기가 파일을 마저 지운다', () => {
  const root = me()
  remember(root, { ...base, by: BY })
  remember(root, { ...base, id: 'other', core: false, by: BY })
  const r = runPm(['me', 'forget', base.id, '--agent', 'claude', '--session', 's1'], { root: makePmRoot(), env: { PM_ME_ROOT: root, PM_TEST_FAULT: 'me-forget-after-mark' } })
  assert.equal(r.code, 137)
  assert.ok(existsSync(join(root, 'items', `${base.id}.md`)))
  assert.deepEqual(readItems(root).map(i => i.id), ['other'])
  editItem(root, { id: 'other', base: 1, kind: 'background', by: BY })
  assert.equal(existsSync(join(root, 'items', `${base.id}.md`)), false)
})

test('삭제 표시는 7일 뒤 정리된다', () => {
  const root = me()
  remember(root, { ...base, by: BY })
  forget(root, { id: base.id, by: BY })
  const mark = join(root, 'forgotten', `${base.id}.json`)
  writeFileSync(mark, JSON.stringify({ ...JSON.parse(readFileSync(mark, 'utf8')), at: new Date(Date.now() - 8 * 86400000).toISOString() }))
  remember(root, { ...base, id: 'next', core: false, by: BY })
  assert.deepEqual(readdirSync(join(root, 'forgotten')), [])
})

test('같은 id 를 두 프로세스가 동시에 remember 하면 하나만 성공', async () => {
  const root = me()
  const pmRootForCli = makePmRoot()
  const run = () => new Promise(resolve => {
    const c = spawn(process.execPath, [PM, 'me', 'remember', '--id', 'race', '--text', 't', '--kind', 'preference', '--scope', 'global', '--source', 's', '--agent', 'claude', '--session', 's1'], { env: { ...process.env, PM_ME_ROOT: root, PM_ROOT: pmRootForCli } })
    c.on('close', resolve)
  })
  const codes = await Promise.all([run(), run()])
  assert.deepEqual(codes.sort(), [0, 1])
  assert.equal(readItems(root).length, 1)
})

test('이관 기록: 원본 위치와 옮긴 부분의 지문으로 확인한다', () => {
  const root = me()
  assert.equal(isMigrated(root, { source: 'C:/m/user_background.md', partSha: 'abc' }), false)
  recordMigration(root, { source: 'C:/m/user_background.md', partSha: 'abc', item: 'react-via-csharp' })
  assert.equal(isMigrated(root, { source: 'C:/m/user_background.md', partSha: 'abc' }), true)
  assert.equal(isMigrated(root, { source: 'C:/m/user_background.md', partSha: 'zzz' }), false)
})

test('파일이 직접 고쳐져 형식이 깨진 항목은 읽을 때 건너뛰고 오류를 남긴다', () => {
  const root = me()
  remember(root, { ...base, by: BY })
  const f = join(root, 'items', `${base.id}.md`)
  writeFileSync(f, '---\nid: explain-conclusion-first\ntext: 두\n---\n')
  utimesSync(f, new Date(), new Date())
  const items = readItems(root, { withInvalid: true })
  assert.equal(items.length, 1)
  assert.ok(items[0].errors.length > 0)
  assert.deepEqual(readItems(root), [])
})
