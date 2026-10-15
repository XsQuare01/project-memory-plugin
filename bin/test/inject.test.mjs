import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { makePmRoot, write, git, runPm } from './helpers.mjs'
import { seedProject, docs, P } from './fixtures/seed.mjs'
import { pinHead, readProject, revisionOf } from '../lib/snapshot.mjs'
import { buildInjection, oneLine } from '../lib/inject.mjs'

const doc = (rel, data) => ({ rel, data: { title: rel, summary: `${rel} 요약`, ...data }, body: '' })
const sample = [
  doc('knowledge/a.md', { type: 'knowledge', status: 'proposed' }),
  doc('questions/q-open.md', { type: 'question', status: 'open' }),
  doc('questions/q-done.md', { type: 'question', status: 'resolved' }),
  doc('decisions/2026-10-01-old.md', { type: 'decision', status: 'active', date: '2026-10-01' }),
  doc('decisions/2026-10-09-new.md', { type: 'decision', status: 'active', date: '2026-10-09' }),
  doc('decisions/2026-09-01-gone.md', { type: 'decision', status: 'superseded', date: '2026-09-01' }),
  doc('knowledge/b.md', { type: 'knowledge', status: 'confirmed' }),
]
const projectDoc = { data: { title: '과제', summary: 's' }, body: '개요\n' }

test('주입 순서: 결정(최신순) → 확정 이해 → 열린 질문 → 제안, superseded·resolved 는 빠진다', () => {
  const { text, omitted } = buildInjection({ header: ['머리'], projectDoc, docs: sample, cap: 6000, tocCommand: 'pm toc p' })
  assert.equal(omitted, 0)
  const at = s => text.indexOf(s)
  assert.ok(at('2026-10-09 new') < at('2026-10-01 old'))
  assert.ok(at('2026-10-01 old') < at('- b —'))
  assert.ok(at('- b —') < at('- q-open —'))
  assert.ok(at('- q-open —') < at('- a —'))
  assert.equal(at('q-done'), -1)
  assert.equal(at('gone'), -1)
  assert.ok(at('개요') > at('머리') && at('개요') < at('2026-10-09'))
})

test('project.md 본문은 30줄·1,500자로 자른다', () => {
  const long = { data: projectDoc.data, body: Array.from({ length: 40 }, (_, i) => `줄${i}`).join('\n') }
  const t1 = buildInjection({ header: ['h'], projectDoc: long, docs: [], cap: 6000, tocCommand: 't' }).text
  assert.match(t1, /줄29/)
  assert.doesNotMatch(t1, /줄30/)
  const wide = { data: projectDoc.data, body: '가'.repeat(3000) }
  const t2 = buildInjection({ header: ['h'], projectDoc: wide, docs: [], cap: 6000, tocCommand: 't' }).text
  assert.ok((t2.match(/가/g) ?? []).length <= 1500)
})

test('요약의 줄바꿈과 긴 글은 한 줄로 정리한다', () => {
  assert.equal(oneLine('a\nb\r\n  c'), 'a b c')
  assert.equal([...oneLine('가'.repeat(200))].length, 120)
})

test('어떤 입력에서도 상한을 넘지 않고, 생략하면 생략 줄을 붙인다 (무작위 200회)', () => {
  let seed = 7
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const kinds = [
    ['knowledge', 'confirmed'], ['knowledge', 'proposed'], ['question', 'open'], ['decision', 'active'],
  ]
  for (let i = 0; i < 200; i++) {
    const count = rand(300)
    const docsN = Array.from({ length: count }, (_, j) => {
      const [type, status] = kinds[rand(kinds.length)]
      const dir = { knowledge: 'knowledge', question: 'questions', decision: 'decisions' }[type]
      return doc(`${dir}/2026-10-${String(1 + rand(28)).padStart(2, '0')}-d${j}.md`, { type, status, date: '2026-10-01', summary: '요'.repeat(1 + rand(120)) })
    })
    const cap = [3000, 6000][rand(2)]
    const pd = { data: projectDoc.data, body: '본'.repeat(rand(3000)) }
    const { text, omitted, included } = buildInjection({ header: ['[프로젝트 메모리] p', '규칙: '.padEnd(300, '…')], projectDoc: pd, docs: docsN, cap, tocCommand: 'pm toc p' })
    assert.ok(text.length <= cap, `회차 ${i}: ${text.length} > ${cap}`)
    assert.equal(included + omitted, count)
    if (omitted > 0) assert.match(text, new RegExp(`생략: 과제 ${omitted}개`))
  }
})

test('고정 커밋에서 읽는다: 커밋 전 상태로 멈춘 apply 의 내용은 보이지 않는다', () => {
  const root = seedProject(makePmRoot())
  const r = runPm(['checkout', 'knowledge/rail.md', '--agent', 'claude', '--session', 's', '--project', 'p'], { root })
  writeFileSync(r.stdout.match(/변경안: (.+)/)[1].trim(), docs.proposed.replace('레일 노드 구조 해석', '커밋되지 않은 요약'))
  assert.equal(runPm(['apply', '-m', 'm', '--agent', 'claude', '--session', 's', '--project', 'p'], { root, env: { PM_TEST_FAULT: 'after-write-1' } }).code, 137)
  const snap = readProject(root, pinHead(root), 'p')
  const rail = snap.docs.find(d => d.rel === 'knowledge/rail.md')
  assert.equal(rail.data.summary, '레일 노드 구조 해석')
  assert.equal(snap.projectDoc.data.title, '테스트 과제')
})

test('고정 커밋 읽기: 한글 파일 이름, 판번호는 그 프로젝트의 마지막 커밋', () => {
  const root = seedProject(makePmRoot())
  write(root, `${P}/knowledge/레일 설명.md`, docs.proposed.replace('레일 구조', '한글 이름 문서'))
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'ko')
  const projectCommit = git(root, 'rev-parse', 'HEAD').trim()
  write(root, 'links.json', '{"x":1}\n')
  git(root, 'commit', '-q', '-am', 'outside project')
  const head = pinHead(root)
  assert.ok(readProject(root, head, 'p').docs.some(d => d.data.title === '한글 이름 문서'))
  assert.equal(revisionOf(root, head, 'p'), projectCommit)
})

test('없는 프로젝트·커밋 없는 저장소는 빈 결과', () => {
  const root = makePmRoot()
  assert.equal(readProject(root, pinHead(root), 'nope').exists, false)
})

test('pm toc: 생략 없이 상태까지 보여 준다', () => {
  const root = seedProject(makePmRoot())
  const r = runPm(['toc', 'p'], { root })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /k3/)
  assert.match(r.stdout, /mesh/)
  assert.match(r.stdout, /manual-stop/)
})
