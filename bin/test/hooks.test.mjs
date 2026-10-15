import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makePmRoot, makeUserRepo, write, git, runPm, tempDir } from './helpers.mjs'
import { seedProject, docs } from './fixtures/seed.mjs'
import { readState } from '../lib/session.mjs'

const REMOTE = 'https://github.com/example-org/web-app.git'

function setup() {
  const root = seedProject(makePmRoot())
  write(root, 'projects/p2/project.md', docs.project.replace('테스트 과제', '두 번째 과제'))
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'p2')
  const repo = makeUserRepo({ remote: REMOTE })
  git(repo, 'switch', '-q', '-c', 'feat/a')
  assert.equal(runPm(['link', 'p', '--agent', 'claude', '--session', 'setup'], { root, cwd: repo }).code, 0)
  return { root, repo }
}

function hook(root, command, { session = 's1', cwd, source = 'startup', raw, agent = 'claude', env } = {}) {
  const input = raw ?? JSON.stringify({ session_id: session, cwd, source, hook_event_name: command === 'context' ? 'SessionStart' : 'UserPromptSubmit' })
  const r = runPm([command, '--agent', agent], { root, input, cwd: root, env: { CLAUDE_PROJECT_DIR: '', ...env } })
  assert.equal(r.code, 0, r.stderr)
  if (!r.stdout.trim()) return null
  const parsed = JSON.parse(r.stdout)
  return { event: parsed.hookSpecificOutput.hookEventName, text: parsed.hookSpecificOutput.additionalContext }
}

test('context: 연결된 브랜치면 주입 글(한글 그대로)과 last_injected 를 남긴다', () => {
  const { root, repo } = setup()
  const out = hook(root, 'context', { cwd: repo })
  assert.equal(out.event, 'SessionStart')
  assert.match(out.text, /\[프로젝트 메모리\] p — 테스트 과제/)
  assert.match(out.text, /세션: claude\/s1/)
  assert.match(out.text, /브랜치 연결 github\.com\/example-org\/web-app@feat\/a/)
  assert.match(out.text, /pm\.mjs/)
  assert.match(out.text, /개요 한 줄/)
  const state = readState(root, 'claude', 's1')
  assert.equal(state.last_injected.project, 'p')
  assert.equal(state.last_injected.revision, git(root, 'log', '-1', '--format=%H', '--', 'projects/p').trim())
  assert.equal(state.selection, null)
})

test('context: 세션 선택이 있으면 그것', () => {
  const { root, repo } = setup()
  runPm(['use', 'p2', '--agent', 'claude', '--session', 's1'], { root, cwd: repo })
  assert.match(hook(root, 'context', { cwd: repo }).text, /\[프로젝트 메모리\] p2 — 두 번째 과제/)
})

test('context: 연결 안 된 브랜치지만 그 저장소에 연결이 있으면 한 줄 안내', () => {
  const { root, repo } = setup()
  git(repo, 'switch', '-q', '-c', 'feat/b')
  const out = hook(root, 'context', { cwd: repo })
  assert.match(out.text, /연결 안 됨/)
  assert.equal(out.text.split('\n').length, 1)
})

test('context: 같은 폴더에서 최근 선택한 프로젝트를 안내만 한다(자동으로 물려주지 않음)', () => {
  const { root } = setup()
  const folder = tempDir('pm-docs-')
  runPm(['use', 'p2', '--agent', 'claude', '--session', 'before-clear'], { root, cwd: folder })
  const out = hook(root, 'context', { session: 'after-clear', cwd: folder, source: 'clear' })
  assert.match(out.text, /이 폴더에서 최근 선택한 프로젝트: p2/)
  assert.doesNotMatch(out.text, /직전 세션/)
  assert.equal(readState(root, 'claude', 'after-clear').selection, null)
})

test('훅: git 밖·빈 입력·깨진 JSON·없는 폴더는 출력 없이 종료 코드 0', () => {
  const { root } = setup()
  assert.equal(hook(root, 'context', { cwd: tempDir('pm-plain-') }), null)
  assert.equal(hook(root, 'context', { raw: '' }), null)
  assert.equal(hook(root, 'context', { raw: '{깨짐' }), null)
  assert.equal(hook(root, 'context', { cwd: 'C:/no/such/folder/here' }), null)
  assert.equal(hook(root, 'turn', { raw: '' }), null)
})

test('turn: 그대로면 출력 없음, 다른 세션이 바꾸면 바뀐 항목, 브랜치를 바꾸면 경고와 새 주입', () => {
  const { root, repo } = setup()
  hook(root, 'context', { cwd: repo })
  const t0 = Date.now()
  assert.equal(hook(root, 'turn', { cwd: repo }), null)
  test.diagnostic?.(`turn 빠른 경로 ${Date.now() - t0}ms`)

  const co = runPm(['checkout', 'knowledge/rail.md', '--agent', 'claude', '--session', 'other', '--project', 'p'], { root })
  writeFileSync(co.stdout.match(/변경안: (.+)/)[1].trim(), docs.proposed.replace('레일 노드 구조 해석', '다른 세션이 고친 요약'))
  assert.equal(runPm(['apply', '-m', 'other', '--agent', 'claude', '--session', 'other', '--project', 'p'], { root }).code, 0)
  const changed = hook(root, 'turn', { cwd: repo })
  assert.equal(changed.event, 'UserPromptSubmit')
  assert.match(changed.text, /바뀌었습니다/)
  assert.match(changed.text, /다른 세션이 고친 요약/)
  assert.equal(hook(root, 'turn', { cwd: repo }), null)

  git(repo, 'switch', '-q', '-c', 'feat/p2-branch')
  runPm(['link', 'p2', '--agent', 'claude', '--session', 'setup'], { root, cwd: repo })
  const switched = hook(root, 'turn', { cwd: repo })
  assert.match(switched.text, /이전 프로젝트\(p\)/)
  assert.match(switched.text, /\[프로젝트 메모리\] p2/)

  git(repo, 'switch', '-q', '-c', 'feat/none')
  assert.match(hook(root, 'turn', { cwd: repo }).text, /더 이상 프로젝트가 정해져 있지 않습니다/)
  assert.equal(hook(root, 'turn', { cwd: repo }), null)
})

test('turn: 자기 세션이 apply·add-source 한 변경은 다음 턴에 "바뀌었습니다"로 되돌아오지 않는다', () => {
  const { root, repo } = setup()
  hook(root, 'context', { cwd: repo })
  const co = runPm(['checkout', 'project.md', '--agent', 'claude', '--session', 's1'], { root, cwd: repo })
  assert.equal(co.code, 0, co.stderr)
  writeFileSync(co.stdout.match(/변경안: (.+)/)[1].trim(), docs.project.replace('개요 한 줄', '내가 고친 개요'))
  assert.equal(runPm(['apply', '-m', 'mine', '--agent', 'claude', '--session', 's1'], { root, cwd: repo }).code, 0)
  assert.equal(hook(root, 'turn', { cwd: repo }), null)
  const src = tempDir('pm-src-')
  write(src, 'a.md', '자료\n')
  assert.equal(runPm(['add-source', join(src, 'a.md'), '--as', 'mine', '--agent', 'claude', '--session', 's1'], { root, cwd: repo }).code, 0)
  assert.equal(hook(root, 'turn', { cwd: repo }), null)
})

test('turn: 상태가 없는 문서(project.md)는 바뀐 항목에 상태 괄호를 붙이지 않는다', () => {
  const { root, repo } = setup()
  hook(root, 'context', { cwd: repo })
  write(root, 'projects/p/project.md', docs.project.replace('개요 한 줄', '남이 고친 개요'))
  git(root, 'commit', '-q', '-am', 'other')
  const text = hook(root, 'turn', { cwd: repo }).text
  assert.match(text, /수정 project\.md — 테스트용 프로젝트/)
  assert.doesNotMatch(text, /\[-\]/)
})

test('Claude 훅은 작업 폴더(cd)가 아니라 세션을 시작한 폴더(CLAUDE_PROJECT_DIR)로 판정한다', () => {
  const { root, repo } = setup()
  const elsewhere = tempDir('pm-elsewhere-')
  const env = { CLAUDE_PROJECT_DIR: repo }
  assert.match(hook(root, 'context', { cwd: elsewhere, env }).text, /\[프로젝트 메모리\] p/)
  assert.equal(hook(root, 'turn', { cwd: elsewhere, env }), null)
})

test('Codex 훅은 CLAUDE_PROJECT_DIR 을 쓰지 않고 입력의 cwd 로 판정한다', () => {
  const { root, repo } = setup()
  const elsewhere = tempDir('pm-elsewhere-')
  assert.equal(hook(root, 'context', { cwd: elsewhere, agent: 'codex', session: 'c1', env: { CLAUDE_PROJECT_DIR: repo } }), null)
})

test('에이전트가 다른 폴더로 옮겨 간 뒤에도 checkout 은 훅이 기록한 세션 폴더로 프로젝트를 정한다', () => {
  const { root, repo } = setup()
  hook(root, 'context', { cwd: repo })
  const elsewhere = tempDir('pm-elsewhere-')
  const r = runPm(['checkout', 'knowledge/rail.md', '--agent', 'claude', '--session', 's1'], { root, cwd: elsewhere })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /projects[\\/]p[\\/]knowledge[\\/]rail\.md/)
})

test('turn: 대화 중 pm use 하면 다음 턴에 주입된다', () => {
  const { root } = setup()
  const folder = tempDir('pm-docs-')
  assert.equal(hook(root, 'turn', { cwd: folder }), null)
  runPm(['use', 'p', '--agent', 'claude', '--session', 's1'], { root, cwd: folder })
  assert.match(hook(root, 'turn', { cwd: folder }).text, /\[프로젝트 메모리\] p — 테스트 과제/)
})

test('주입 글은 도구별 상한을 지킨다(codex 3000자)', () => {
  const { root, repo } = setup()
  for (let i = 0; i < 80; i++) {
    write(root, `projects/p/questions/q${i}.md`, docs.question.replace('수동에서 레일이 멈추나', `${'긴 질문 요약 '.repeat(8)}${i}`))
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'many')
  const r = runPm(['context', '--agent', 'codex'], { root, input: JSON.stringify({ session_id: 'c1', cwd: repo, source: 'startup' }) })
  const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  assert.ok(text.length <= 3000, String(text.length))
  assert.match(text, /생략: 과제 \d+개/)
})
