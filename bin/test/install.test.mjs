// 플러그인 이전의 수동 설치(훅·스킬·CLAUDE.md 절·차단 훅 주석)를 걷어 내는 명령.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { tempDir, write, runPm, makePmRoot } from './helpers.mjs'

const SETTINGS = {
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'bash "$HOME/.claude/hooks/env-check.sh"', shell: 'bash', timeout: 25, statusMessage: '환경 점검 중...' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'C:/tools/other-hook.cmd', timeout: 10 }] }],
  },
  permissions: { allow: ['Bash(ls:*)'] },
}
const HOOK_SH = '#!/usr/bin/env bash\n# Claude 가 git commit 을 직접 실행하지 못하게 막는다.\nBLOCKED_REPOS=("example-org/web-app")\n'
const ORIGINAL_MD = '# Global Claude Instructions\n\n기존 내용\n'

function fakeHome() {
  const home = tempDir('pm-claude-')
  write(home, 'settings.json', JSON.stringify(SETTINGS, null, 2))
  write(home, 'CLAUDE.md', ORIGINAL_MD)
  write(home, 'hooks/block-git-commit.sh', HOOK_SH)
  return home
}
const run = (home, ...args) => runPm(['install', 'claude', ...args], { root: makePmRoot(), env: { PM_CLAUDE_HOME: home } })

/** 플러그인 이전 방식으로 설치된 상태를 만든다(라이브러리 설치 경로를 그대로 쓴다). */
async function legacyInstalled(home) {
  process.env.PM_CLAUDE_HOME = home
  const { planClaude, applyPlan } = await import('../lib/install-claude.mjs')
  applyPlan(planClaude(), 'test')
  delete process.env.PM_CLAUDE_HOME
  return home
}
const settings = home => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))

test('install claude(걷어 내기 없이)는 아무것도 바꾸지 않고 플러그인 설치를 안내한다', () => {
  const home = fakeHome()
  const r = run(home)
  assert.equal(r.code, 2)
  assert.match(r.stderr, /plugin/)
  assert.deepEqual(settings(home), SETTINGS)
  assert.equal(existsSync(join(home, 'skills/project')), false)
})

test('install claude --remove 는 옛 수동 설치만 걷어 내고 나머지는 그대로 둔다', async () => {
  const home = await legacyInstalled(fakeHome())
  assert.ok(existsSync(join(home, 'skills/project/SKILL.md')))
  const r = run(home, '--remove')
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(settings(home).hooks, SETTINGS.hooks)
  assert.deepEqual(settings(home).permissions, SETTINGS.permissions)
  assert.equal(existsSync(join(home, 'skills/project')), false)
  assert.equal(readFileSync(join(home, 'CLAUDE.md'), 'utf8'), ORIGINAL_MD)
  assert.equal(readFileSync(join(home, 'hooks/block-git-commit.sh'), 'utf8'), HOOK_SH)
  assert.ok(readdirSync(home).some(f => f.startsWith('settings.json.bak-pm-')))
})

test('install claude --remove --dry-run 은 바꿀 것만 보인다', async () => {
  const home = await legacyInstalled(fakeHome())
  const before = readFileSync(join(home, 'settings.json'), 'utf8')
  const r = run(home, '--remove', '--dry-run')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /settings\.json/)
  assert.equal(readFileSync(join(home, 'settings.json'), 'utf8'), before)
})

test('걷어 낼 것이 없으면 바꿀 것 없음', () => {
  const home = fakeHome()
  const r = run(home, '--remove')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /바꿀 것 없음/)
})
