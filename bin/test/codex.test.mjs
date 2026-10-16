import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makePmRoot, makeUserRepo, git, runPm, tempDir } from './helpers.mjs'
import { seedProject } from './fixtures/seed.mjs'
import { readState } from '../lib/session.mjs'

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const json = rel => JSON.parse(readFileSync(join(PLUGIN, rel), 'utf8'))

test('Codex 매니페스트: Claude 와 같은 버전, 훅은 PLUGIN_ROOT·--agent codex, 스킬 폴더가 있다', () => {
  const claude = json('.claude-plugin/plugin.json')
  const codex = json('.codex-plugin/plugin.json')
  assert.equal(codex.name, claude.name)
  assert.equal(codex.version, claude.version)
  const hooksPath = codex.hooks
  assert.match(hooksPath, /^\.\//)
  const hooks = json(hooksPath).hooks
  for (const [event, kind] of [['SessionStart', 'context'], ['UserPromptSubmit', 'turn']]) {
    const [handler] = hooks[event][0].hooks
    assert.equal(handler.command, `node "\${PLUGIN_ROOT}/bin/pm.mjs" ${kind} --agent codex`)
  }
  const skill = readFileSync(join(PLUGIN, codex.skills, 'project', 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\nname: project\ndescription: /)
  // 스킬에서 플러그인 폴더(네 단계 위)로 가면 pm.mjs 가 있다.
  assert.ok(existsSync(join(PLUGIN, codex.skills, 'project', '../../../..', 'bin', 'pm.mjs')))
  const market = json('.agents/plugins/marketplace.json')
  assert.equal(market.plugins[0].name, codex.name)
})

test('외부 패키지는 bin/vendor 묶음만 쓴다(설치본에 node_modules 가 없어도 된다)', () => {
  const pkg = json('package.json')
  const versions = json('bin/vendor/versions.json')
  for (const name of ['yaml', 'marked', 'dompurify']) assert.equal(versions[name], pkg.devDependencies[name], name)
  assert.equal(pkg.dependencies, undefined)
  assert.match(readFileSync(join(PLUGIN, 'bin/vendor/yaml.cjs'), 'utf8').slice(0, 80), new RegExp(`yaml ${versions.yaml}`))
  const bare = /(?:from\s+|require\(\s*|import\(\s*)['"](yaml|marked|dompurify)['"]/
  for (const dir of ['bin/lib', 'bin/commands']) {
    for (const f of readdirSync(join(PLUGIN, dir))) {
      assert.doesNotMatch(readFileSync(join(PLUGIN, dir, f), 'utf8'), bare, `${dir}/${f}`)
    }
  }
})

test('node_modules 없이 복사한 설치본으로 Codex 세션 시작 주입이 된다', () => {
  const root = seedProject(makePmRoot())
  const repo = makeUserRepo({ remote: 'https://github.com/example-org/web-app.git' })
  git(repo, 'switch', '-q', '-c', 'feat/a')
  assert.equal(runPm(['link', 'p', '--agent', 'codex', '--session', 'setup'], { root, cwd: repo }).code, 0)

  const installed = tempDir('pm-installed-')
  cpSync(join(PLUGIN, 'bin'), join(installed, 'bin'), { recursive: true, filter: src => !src.includes(`${join('bin', 'test')}`) })
  cpSync(join(PLUGIN, 'policy.md'), join(installed, 'policy.md'))
  const r = spawnSync(process.execPath, [join(installed, 'bin', 'pm.mjs'), 'context', '--agent', 'codex'], {
    cwd: repo,
    input: JSON.stringify({ session_id: 'c1', cwd: repo, hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8',
    env: { ...process.env, PM_ROOT: root, PM_ME_ROOT: tempDir('pm-me-'), PM_CONFIG_DIR: tempDir('pm-config-'), CLAUDE_PROJECT_DIR: '' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  assert.match(text, /\[프로젝트 메모리\] p — 테스트 과제/)
  assert.match(text, /세션: codex\/c1/)
  assert.match(text, /project-memory:project 스킬/)
  assert.ok(text.includes(join(installed, 'bin', 'pm.mjs').replace(/\\/g, '/')))
})

test('--agent codex 는 --session 이 없으면 CODEX_THREAD_ID 를 쓴다(다른 도구는 쓰지 않는다)', () => {
  const root = seedProject(makePmRoot())
  const r = runPm(['use', 'p', '--agent', 'codex'], { root, env: { CODEX_THREAD_ID: 't-1', PM_SESSION: '' } })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(readState(root, 'codex', 't-1').selection.project, 'p')
  assert.equal(runPm(['use', 'p', '--agent', 'codex'], { root, env: { CODEX_THREAD_ID: '', PM_SESSION: '' } }).code, 2)
  assert.equal(runPm(['use', 'p', '--agent', 'claude'], { root, env: { CODEX_THREAD_ID: 't-1', PM_SESSION: '' } }).code, 2)
})

test('status --agent codex 는 CODEX_THREAD_ID 의 세션을 보인다', () => {
  const root = seedProject(makePmRoot())
  runPm(['use', 'p', '--agent', 'codex'], { root, env: { CODEX_THREAD_ID: 't-2', PM_SESSION: '' } })
  const r = runPm(['status', '--agent', 'codex'], { root, env: { CODEX_THREAD_ID: 't-2', PM_SESSION: '' } })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /세션: codex\/t-2/)
  assert.match(r.stdout, /판정: p \(use\)/)
})

test('git 소유자 검사 예외는 과제 데이터 저장소에만 붙는다(Codex 샌드박스 사용자 대비)', async () => {
  const { ownershipOverride } = await import('../lib/git.mjs')
  const root = makePmRoot()
  const before = process.env.PM_ROOT
  process.env.PM_ROOT = root
  try {
    assert.deepEqual(ownershipOverride(root), ['-c', `safe.directory=${root.replaceAll('\\', '/')}`])
    assert.deepEqual(ownershipOverride(makeUserRepo()), [])
  } finally {
    if (before === undefined) delete process.env.PM_ROOT
    else process.env.PM_ROOT = before
  }
})
