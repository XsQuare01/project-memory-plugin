// 테스트 전용 도구: 임시 PM_ROOT·사용자 저장소를 만들고 pm 을 자식 프로세스로 부른다.
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'pm.mjs')

const made = []
process.on('exit', () => {
  for (const dir of made) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 테스트 뒤 정리 실패는 무시한다 */ }
  }
})

export function tempDir(prefix = 'pm-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

export function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${r.stderr}`)
  return r.stdout
}

export function write(root, rel, content) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

// git 저장소를 테스트마다 새로 만들면 Windows 에서 spawn 이 느리다. 한 번 만든 틀을 복사한다.
const templates = {}
function fromTemplate(kind, build, prefix) {
  if (!templates[kind]) {
    templates[kind] = tempDir(`pm-tpl-${kind}-`)
    build(templates[kind])
  }
  const dir = tempDir(prefix)
  cpSync(templates[kind], dir, { recursive: true })
  return dir
}

/** 첫 커밋까지 있는 빈 프로젝트 메모리 저장소. */
export function makePmRoot() {
  return fromTemplate('root', root => {
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.name', 'pm-test')
    git(root, 'config', 'user.email', 'pm-test@example.invalid')
    write(root, '.gitattributes', '* -text\n')
    write(root, '.gitignore', readFileSync(join(dirname(PM), 'templates', 'data.gitignore')))
    write(root, 'links.json', '{}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
  }, 'pm-root-')
}

/** 사용자 작업 저장소 흉내(main 브랜치, 빈 커밋 하나). remote 를 주면 origin 으로 등록한다. */
export function makeUserRepo({ remote } = {}) {
  const repo = fromTemplate('user', dir => {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.name', 'pm-test')
    git(dir, 'config', 'user.email', 'pm-test@example.invalid')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base')
  }, 'pm-user-')
  if (remote) git(repo, 'remote', 'add', 'origin', remote)
  return repo
}

// 실제 사용자 메모리(~/personal-memory)가 테스트에 섞이지 않게, 기본으로 빈 폴더를 가리킨다.
const EMPTY_ME = tempDir('pm-me-empty-')
// 훅이 위치를 남기는 설정 파일도 실제 ~/.project-memory 가 아니라 임시 폴더로.
const CONFIG = tempDir('pm-config-')

export function runPm(args, { root, input, cwd, env } = {}) {
  const r = spawnSync(process.execPath, [PM, ...args], {
    cwd: cwd ?? root ?? process.cwd(),
    input,
    encoding: 'utf8',
    env: { ...process.env, PM_ME_ROOT: EMPTY_ME, PM_CONFIG_DIR: CONFIG, ...(root ? { PM_ROOT: root } : {}), ...env },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}
