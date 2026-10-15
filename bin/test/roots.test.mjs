// 저장 위치 정하기: 테스트 변수 → 플러그인 옵션(훅) → 훅이 남긴 설정 파일 → 기본값.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { tempDir, runPm, git, makePmRoot } from './helpers.mjs'

// roots.mjs 는 환경 변수를 읽으므로, 조합마다 자식 프로세스에서 확인한다.
function rootsWith(env) {
  const code = "import('./bin/lib/roots.mjs').then(m => process.stdout.write(JSON.stringify({ project: m.projectRoot(), personal: m.personalRoot() })))"
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PM_ROOT|PM_ME_ROOT|CLAUDE_PLUGIN_OPTION_)/.test(k)))
  const r = spawnSync(process.execPath, ['-e', code], { cwd: join(import.meta.dirname, '..', '..'), env: { ...clean, ...env }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('기본값은 홈의 project-memory·personal-memory', () => {
  const cfg = tempDir('pm-cfg-')
  assert.deepEqual(rootsWith({ PM_CONFIG_DIR: cfg }), { project: join(homedir(), 'project-memory'), personal: join(homedir(), 'personal-memory') })
})

test('플러그인 옵션이 기본값보다, 테스트 변수가 옵션보다 먼저', () => {
  const cfg = tempDir('pm-cfg-')
  const opt = { PM_CONFIG_DIR: cfg, CLAUDE_PLUGIN_OPTION_PROJECT_ROOT: 'D:/data/pm', CLAUDE_PLUGIN_OPTION_PERSONAL_ROOT: 'D:/data/me' }
  assert.deepEqual(rootsWith(opt), { project: 'D:\\data\\pm', personal: 'D:\\data\\me' })
  assert.equal(rootsWith({ ...opt, PM_ROOT: 'E:/t', PM_ME_ROOT: 'E:/m' }).project, 'E:\\t')
})

test('훅이 옵션을 설정 파일에 남기면, 옵션이 없는 명령(에이전트 실행)도 같은 위치를 쓴다', () => {
  const cfg = tempDir('pm-cfg-')
  const data = tempDir('pm-data-')
  const me = tempDir('pm-me-')
  const r = runPm(['context', '--agent', 'claude'], {
    input: JSON.stringify({ session_id: 's1', cwd: data }),
    env: { PM_ROOT: '', PM_ME_ROOT: '', PM_CONFIG_DIR: cfg, CLAUDE_PLUGIN_OPTION_PROJECT_ROOT: data, CLAUDE_PLUGIN_OPTION_PERSONAL_ROOT: me },
  })
  assert.equal(r.code, 0, r.stderr)
  const saved = JSON.parse(readFileSync(join(cfg, 'config.json'), 'utf8'))
  assert.equal(saved.projectRoot, data)
  assert.equal(saved.personalRoot, me)
  assert.deepEqual(rootsWith({ PM_CONFIG_DIR: cfg }), { project: data, personal: me })
})

test('빈 데이터 폴더는 첫 쓰기 때 저장소로 준비된다(.gitattributes·.gitignore·links.json 커밋)', () => {
  const parent = tempDir('pm-data-')
  const data = join(parent, 'new-root')
  const r = runPm(['new', 'p', '--title', '과제', '--summary', '요약'], { root: data, cwd: parent })
  assert.equal(r.code, 0, r.stderr)
  for (const f of ['.gitattributes', '.gitignore', 'links.json', 'projects/p/project.md']) assert.ok(existsSync(join(data, f)), f)
  assert.equal(git(data, 'status', '--porcelain'), '')
  assert.match(readFileSync(join(data, '.gitignore'), 'utf8'), /\*\.glb/)
})

test('이미 있는 데이터 저장소는 건드리지 않는다', () => {
  const root = makePmRoot()
  const before = git(root, 'rev-list', '--count', 'HEAD')
  assert.equal(runPm(['new', 'p', '--title', '과제', '--summary', '요약'], { root }).code, 0)
  assert.equal(Number(git(root, 'rev-list', '--count', 'HEAD')), Number(before) + 1)
})
