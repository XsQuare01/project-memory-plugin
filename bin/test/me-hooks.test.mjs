// 사용자 메모리의 주입·턴 알림(설계 ②). 훅을 실제 명령으로 돌린다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePmRoot, makeUserRepo, write, git, runPm, tempDir } from './helpers.mjs'
import { seedProject, docs } from './fixtures/seed.mjs'
import { remember, editItem, forget } from '../lib/me-store.mjs'

const REMOTE = 'https://github.com/example-org/web-app.git'
const OTHER = 'claude/other-session'
const item = (id, extra = {}) => ({ id, text: `${id} 내용`, kind: 'preference', scope: 'global', source: 's', by: OTHER, ...extra })

function setup({ company } = {}) {
  const root = seedProject(makePmRoot())
  if (company) {
    write(root, 'projects/p/project.md', docs.project.replace('repos: []', `repos: []\ncompany: ${company}`))
    git(root, 'commit', '-q', '-am', 'company')
  }
  const repo = makeUserRepo({ remote: REMOTE })
  assert.equal(runPm(['link', 'p', '--agent', 'claude', '--session', 'setup'], { root, cwd: repo }).code, 0)
  return { root, repo, meRoot: tempDir('pm-me-') }
}

function hook(ctx, command, { session = 's1', cwd } = {}) {
  const input = JSON.stringify({ session_id: session, cwd, hook_event_name: command === 'context' ? 'SessionStart' : 'UserPromptSubmit' })
  const r = runPm([command, '--agent', 'claude'], { root: ctx.root, input, env: { PM_ME_ROOT: ctx.meRoot, CLAUDE_PROJECT_DIR: '' } })
  assert.equal(r.code, 0, r.stderr)
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
}

test('과제 없는 세션: 사용자 핵심과 그 밖의 global 만, 다른 범위 항목은 없음', () => {
  const ctx = setup()
  remember(ctx.meRoot, item('core-a', { core: true }))
  remember(ctx.meRoot, item('plain-b'))
  remember(ctx.meRoot, item('proj-p', { scope: 'project:p' }))
  remember(ctx.meRoot, item('co-x', { scope: 'company:x' }))
  const text = hook(ctx, 'context', { cwd: tempDir('pm-plain-') })
  assert.match(text, /\[사용자 메모리\] 지금 요청이 우선/)
  assert.ok(text.indexOf('core-a 내용') < text.indexOf('plain-b 내용'))
  assert.doesNotMatch(text, /proj-p|co-x/)
})

test('과제 세션: 핵심 → 과제 → 이 과제·회사 범위 → 제안 → 그 밖, 다른 회사 항목은 없음', () => {
  const ctx = setup({ company: 'acme' })
  remember(ctx.meRoot, item('core-a', { core: true }))
  remember(ctx.meRoot, item('plain-b'))
  remember(ctx.meRoot, item('proj-p', { scope: 'project:p' }))
  remember(ctx.meRoot, item('co-acme', { scope: 'company:acme' }))
  remember(ctx.meRoot, item('co-other', { scope: 'company:other' }))
  remember(ctx.meRoot, item('proj-q', { scope: 'project:q' }))
  const text = hook(ctx, 'context', { cwd: ctx.repo })
  const at = s => text.indexOf(s)
  assert.ok(at('core-a 내용') < at('[프로젝트 메모리] p'))
  assert.ok(at('manual-stop') < at('co-acme 내용'))
  assert.ok(at('co-acme 내용') < at('proj-p 내용'))
  assert.ok(at('proj-p 내용') < at('- rail —'))
  assert.ok(at('- rail —') < at('plain-b 내용'))
  assert.doesNotMatch(text, /co-other|proj-q/)
})

test('재확인일이 지난 항목은 표시를 붙인다', () => {
  const ctx = setup()
  remember(ctx.meRoot, item('role', { kind: 'background', reviewAfter: '2020-01-01' }))
  assert.match(hook(ctx, 'context', { cwd: ctx.repo }), /role 내용 \(재확인 필요\)/)
})

test('상한 안에서 사용자 항목은 자르지 않고 통째로 넣거나 생략한다', () => {
  const ctx = setup()
  for (let i = 0; i < 80; i++) remember(ctx.meRoot, item(`long-${String(i).padStart(2, '0')}`, { text: `${'가'.repeat(100)}${i}` }))
  const text = hook(ctx, 'context', { cwd: ctx.repo })
  assert.ok(text.length <= 6000)
  for (const line of text.split('\n').filter(l => l.includes('가가가'))) assert.match(line, /^- 가{100}\d+$/)
  assert.match(text, /사용자 메모리 \d+개/)
})

test('턴 알림: 남의 추가는 알리고, 자기 변경과 범위 밖 변경은 알리지 않는다', () => {
  const ctx = setup()
  hook(ctx, 'context', { cwd: ctx.repo })
  remember(ctx.meRoot, item('new-global'))
  assert.match(hook(ctx, 'turn', { cwd: ctx.repo }), /new-global 내용/)
  assert.equal(hook(ctx, 'turn', { cwd: ctx.repo }), null)
  remember(ctx.meRoot, item('mine', { by: 'claude/s1' }))
  assert.equal(hook(ctx, 'turn', { cwd: ctx.repo }), null)
  remember(ctx.meRoot, item('elsewhere', { scope: 'project:q' }))
  assert.equal(hook(ctx, 'turn', { cwd: ctx.repo }), null)
})

test('턴 알림: 범위가 다른 과제로 바뀌거나 지워지면 "이제 적용하지 않음"', () => {
  const ctx = setup()
  remember(ctx.meRoot, item('moving', { scope: 'project:p' }))
  remember(ctx.meRoot, item('doomed'))
  hook(ctx, 'context', { cwd: ctx.repo })
  editItem(ctx.meRoot, { id: 'moving', base: 1, scope: 'project:q', by: OTHER })
  forget(ctx.meRoot, { id: 'doomed', by: OTHER })
  const text = hook(ctx, 'turn', { cwd: ctx.repo })
  assert.match(text, /이제 적용하지 않음: moving/)
  assert.match(text, /이제 적용하지 않음: doomed/)
  assert.doesNotMatch(text, /moving 내용/)
})

test('pm status 는 이 세션에 실제로 전달한 사용자 항목(ID·판번호)을 보인다', () => {
  const ctx = setup()
  remember(ctx.meRoot, item('core-a', { core: true }))
  hook(ctx, 'context', { cwd: ctx.repo })
  editItem(ctx.meRoot, { id: 'core-a', base: 1, kind: 'background', by: OTHER })
  const r = runPm(['status', '--agent', 'claude', '--session', 's1'], { root: ctx.root, cwd: ctx.repo, env: { PM_ME_ROOT: ctx.meRoot } })
  assert.match(r.stdout, /전달한 사용자 메모리: core-a@1/)
})
