import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { makePmRoot, write, git as gitT } from './helpers.mjs'
import { git, gitText } from '../lib/git.mjs'
import { sha256, atomicWrite } from '../lib/fsx.mjs'
import { parseDoc, serializeDoc, validateDoc } from '../lib/frontmatter.mjs'
import { isValidProjectName, normalizeRel, classifyPath } from '../lib/names.mjs'

test('git 래퍼: 한글·공백 경로가 ls-tree -z 에서 그대로 나온다', () => {
  const root = makePmRoot()
  write(root, 'projects/한글 폴더/레일 설계.md', '내용\n')
  gitT(root, 'add', '-A')
  gitT(root, 'commit', '-q', '-m', 'add')
  const names = gitText(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']).split('\0').filter(Boolean)
  assert.ok(names.includes('projects/한글 폴더/레일 설계.md'))
})

test('git 래퍼: 실패하면 PmError, allowFail 이면 상태만 돌려준다', () => {
  const root = makePmRoot()
  assert.throws(() => git(root, ['show', 'no-such-ref:x']), /git show/)
  assert.notEqual(git(root, ['show', 'no-such-ref:x'], { allowFail: true }).status, 0)
})

test('atomicWrite 는 임시 파일을 남기지 않고 내용을 바꾼다', () => {
  const root = makePmRoot()
  const path = join(root, 'a', 'b.txt')
  atomicWrite(path, Buffer.from('하나'))
  atomicWrite(path, Buffer.from('둘'))
  assert.equal(readFileSync(path, 'utf8'), '둘')
  assert.deepEqual(readdirSync(join(root, 'a')), ['b.txt'])
})

test('sha256 은 바이트 기준이다 (CRLF 와 LF 가 다르다)', () => {
  assert.notEqual(sha256(Buffer.from('a\r\n')), sha256(Buffer.from('a\n')))
  assert.equal(sha256(Buffer.from('a')).length, 64)
})

const knowledge = `---
title: 레일 메시
summary: 메시 3종을 어느 노드에 붙이나
type: knowledge
status: proposed
evidence:
  - source: sample-meshes@2026-10-11-3f9a1c2e
updated: 2026-10-14
---
본문
`

test('머리말: LF 와 CRLF 모두 읽는다', () => {
  const lf = parseDoc(Buffer.from(knowledge))
  assert.equal(lf.data.title, '레일 메시')
  assert.equal(lf.body, '본문\n')
  const crlf = parseDoc(Buffer.from(knowledge.replace(/\n/g, '\r\n')))
  assert.equal(crlf.data.status, 'proposed')
  assert.deepEqual(crlf.data.evidence, [{ source: 'sample-meshes@2026-10-11-3f9a1c2e' }])
})

test('머리말이 없으면 data 는 null', () => {
  assert.equal(parseDoc(Buffer.from('그냥 본문\n')).data, null)
})

test('serializeDoc 결과를 다시 읽으면 같은 값', () => {
  const { data, body } = parseDoc(Buffer.from(knowledge))
  const again = parseDoc(Buffer.from(serializeDoc(data, body)))
  assert.deepEqual(again.data, data)
  assert.equal(again.body, body)
})

test('validateDoc: 올바른 지식 문서는 오류 없음', () => {
  assert.deepEqual(validateDoc('knowledge/rail.md', parseDoc(Buffer.from(knowledge)).data), [])
})

test('validateDoc: 필수 필드·형식 오류를 짚는다', () => {
  const bad = { title: '', summary: '두 줄\n요약', type: 'knowledge', status: 'maybe', evidence: [] }
  const errors = validateDoc('knowledge/x.md', bad).join('\n')
  assert.match(errors, /title/)
  assert.match(errors, /summary/)
  assert.match(errors, /status/)
  assert.match(errors, /evidence/)
})

test('validateDoc: summary 120자 초과는 오류', () => {
  const doc = { ...parseDoc(Buffer.from(knowledge)).data, summary: '가'.repeat(121) }
  assert.match(validateDoc('knowledge/x.md', doc).join(), /summary/)
})

test('validateDoc: 결정·질문 필수 필드', () => {
  assert.match(validateDoc('decisions/2026-10-07-x.md', { title: 't', summary: 's', type: 'decision', status: 'active' }).join(), /date|decided_by/)
  assert.deepEqual(validateDoc('decisions/2026-10-07-x.md', { title: 't', summary: 's', type: 'decision', status: 'active', date: '2026-10-07', decided_by: '사용자' }), [])
  assert.deepEqual(validateDoc('questions/q.md', { title: 't', summary: 's', type: 'question', status: 'open', asked: '2026-10-07' }), [])
  assert.match(validateDoc('questions/q.md', { title: 't', summary: 's', type: 'question', status: 'closed', asked: '2026-10-07' }).join(), /status/)
})

test('validateDoc: 근거 항목은 source·decision·knowledge·user 중 하나의 키', () => {
  const doc = { ...parseDoc(Buffer.from(knowledge)).data, evidence: [{ url: 'x' }] }
  assert.match(validateDoc('knowledge/x.md', doc).join(), /evidence/)
})

test('프로젝트 이름 규칙', () => {
  assert.ok(isValidProjectName('acme-paint-cell'))
  assert.ok(isValidProjectName('p1234-acme'))
  for (const bad of ['Acme', 'acme_paint', '-acme', 'acme-', 'acme--x', 'a'.repeat(41), '', '한글']) {
    assert.equal(isValidProjectName(bad), false, bad)
  }
})

test('normalizeRel: 역슬래시를 바꾸고 밖으로 나가는 경로를 거부', () => {
  assert.equal(normalizeRel('knowledge\\rail.md'), 'knowledge/rail.md')
  for (const bad of ['../x.md', 'a/../../x', 'C:/abs.md', '/abs.md', '']) {
    assert.throws(() => normalizeRel(bad), /경로/, bad)
  }
})

test('classifyPath: 저장소 상대 경로를 프로젝트·영역으로 나눈다', () => {
  assert.deepEqual(classifyPath('projects/acme/knowledge/rail.md'), { project: 'acme', area: 'knowledge', rest: 'rail.md' })
  assert.deepEqual(classifyPath('projects/acme/project.md'), { project: 'acme', area: 'project', rest: 'project.md' })
  assert.equal(classifyPath('projects/acme/sources/x/source.json').area, 'sources')
  assert.equal(classifyPath('links.json').project, null)
})
