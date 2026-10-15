// 최우선 검증(설계 11): 실패·강제 종료 복구와 동시 apply. 실제 명령을 자식 프로세스로 돌린다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { makePmRoot, git, runPm, PM } from './helpers.mjs'
import { seedProject, docs, P } from './fixtures/seed.mjs'
import { readManifest } from '../lib/drafts.mjs'

const S = ['--agent', 'claude', '--session', 'sess-1', '--project', 'p']
const read = (root, rel) => readFileSync(join(root, rel), 'utf8')
const journals = root => (existsSync(join(root, 'runtime', 'journal')) ? readdirSync(join(root, 'runtime', 'journal')) : [])

/** 두 파일 변경안: rail.md 수정 + new.md 신규. */
function twoDrafts() {
  const root = seedProject(makePmRoot())
  const a = runPm(['checkout', 'knowledge/rail.md', ...S], { root })
  assert.equal(a.code, 0, a.stderr)
  writeFileSync(a.stdout.match(/변경안: (.+)/)[1].trim(), docs.proposed.replace('첫 줄', '고친 첫 줄'))
  const b = runPm(['checkout', 'questions/new.md', '--new', ...S], { root })
  assert.equal(b.code, 0, b.stderr)
  writeFileSync(b.stdout.match(/변경안: (.+)/)[1].trim(), docs.question.replace('수동 레일 정지', '새 질문'))
  return root
}

function assertUntouched(root, head) {
  assert.equal(git(root, 'rev-parse', 'HEAD'), head)
  assert.equal(read(root, `${P}/knowledge/rail.md`), docs.proposed)
  assert.equal(existsSync(join(root, `${P}/questions/new.md`)), false)
  assert.equal(git(root, 'status', '--porcelain'), '')
  assert.deepEqual(journals(root), [])
  assert.deepEqual(Object.keys(readManifest(root, 'claude', 'sess-1')).sort(), [`${P}/knowledge/rail.md`, `${P}/questions/new.md`])
}

for (const fault of ['write-2-fail', 'commit-fail']) {
  test(`${fault}: 정본·스테이징이 원래대로, 새 파일은 없고, 변경안은 남는다`, () => {
    const root = twoDrafts()
    const head = git(root, 'rev-parse', 'HEAD')
    const r = runPm(['apply', '-m', 'm', ...S], { root, env: { PM_TEST_FAULT: fault } })
    assert.notEqual(r.code, 0)
    assertUntouched(root, head)
  })
}

test('git add 뒤 커밋 전 강제 종료: 다음 apply 가 먼저 되돌리고 그대로 반영한다', () => {
  const root = twoDrafts()
  const crashed = runPm(['apply', '-m', 'm', ...S], { root, env: { PM_TEST_FAULT: 'after-add' } })
  assert.equal(crashed.code, 137)
  assert.notEqual(git(root, 'diff', '--cached', '--name-only'), '', '종료 직후에는 스테이징에 남아 있어야 재현이 된다')
  const again = runPm(['apply', '-m', '다시 반영', ...S], { root })
  assert.equal(again.code, 0, again.stderr)
  assert.match(read(root, `${P}/knowledge/rail.md`), /고친 첫 줄/)
  assert.match(read(root, `${P}/questions/new.md`), /새 질문/)
  assert.equal(git(root, 'status', '--porcelain'), '')
  assert.deepEqual(journals(root), [])
})

test('강제 종료 뒤 checkout 도 미커밋 변경으로 거부되지 않는다(먼저 복구)', () => {
  const root = twoDrafts()
  runPm(['apply', '-m', 'm', ...S], { root, env: { PM_TEST_FAULT: 'after-add' } })
  const r = runPm(['checkout', 'decisions/2026-10-07-k3.md', '--agent', 'claude', '--session', 'other', '--project', 'p'], { root })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(read(root, `${P}/knowledge/rail.md`), docs.proposed)
})

test('작업 커밋 뒤 강제 종료: 커밋 결과는 유지하고 작업 기록·변경안만 정리한다', () => {
  const root = twoDrafts()
  const crashed = runPm(['apply', '-m', 'm', ...S], { root, env: { PM_TEST_FAULT: 'after-commit' } })
  assert.equal(crashed.code, 137)
  const head = git(root, 'rev-parse', 'HEAD')
  assert.equal(journals(root).length, 1)
  const r = runPm(['recover'], { root })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(git(root, 'rev-parse', 'HEAD'), head)
  assert.match(read(root, `${P}/knowledge/rail.md`), /고친 첫 줄/)
  assert.deepEqual(journals(root), [])
  assert.deepEqual(readManifest(root, 'claude', 'sess-1'), {})
})

function runAsync(args, root) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [PM, ...args], { cwd: root, env: { ...process.env, PM_ROOT: root } })
    let stderr = ''
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => resolve({ code, stderr }))
  })
}

test('동시 apply: 같은 파일이면 하나는 커밋, 하나는 충돌(3)', async () => {
  const root = seedProject(makePmRoot())
  for (const s of ['s1', 's2']) {
    const r = runPm(['checkout', 'knowledge/rail.md', '--agent', 'claude', '--session', s, '--project', 'p'], { root })
    writeFileSync(r.stdout.match(/변경안: (.+)/)[1].trim(), docs.proposed.replace('첫 줄', `${s} 의 첫 줄`))
  }
  const results = await Promise.all(['s1', 's2'].map(s => runAsync(['apply', '-m', s, '--agent', 'claude', '--session', s, '--project', 'p'], root)))
  assert.deepEqual(results.map(r => r.code).sort(), [0, 3])
  assert.equal(git(root, 'status', '--porcelain'), '')
})

test('동시 apply: 다른 파일이면 둘 다 커밋되고 서로 섞이지 않는다', async () => {
  const root = seedProject(makePmRoot())
  const files = { s1: 'knowledge/rail.md', s2: 'questions/manual-stop.md' }
  for (const [s, rel] of Object.entries(files)) {
    const r = runPm(['checkout', rel, '--agent', 'claude', '--session', s, '--project', 'p'], { root })
    const path = r.stdout.match(/변경안: (.+)/)[1].trim()
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n$/, `\n${s} 추가\n`))
  }
  const before = Number(git(root, 'rev-list', '--count', 'HEAD'))
  const results = await Promise.all(Object.keys(files).map(s => runAsync(['apply', '-m', s, '--agent', 'claude', '--session', s, '--project', 'p'], root)))
  assert.deepEqual(results.map(r => r.code), [0, 0], results.map(r => r.stderr).join('\n'))
  assert.equal(Number(git(root, 'rev-list', '--count', 'HEAD')), before + 2)
  for (const [s, rel] of Object.entries(files)) {
    const commit = git(root, 'log', '-1', '--format=%H', `--grep=Session: ${s}`).trim()
    assert.deepEqual(git(root, 'show', '--name-only', '--format=', commit).trim().split('\n'), [`${P}/${rel}`])
  }
})
