import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PmError } from './errors.mjs'
import { projectRoot } from './roots.mjs'

const slash = p => resolve(p).replace(/\\/g, '/')
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/**
 * 과제 데이터 저장소에서만 git 의 소유자 검사(safe.directory)를 푼다.
 * Codex 의 Windows 샌드박스는 명령을 다른 사용자(CodexSandboxOffline)로 실행해, 사용자가 만든 저장소를
 * git 이 "dubious ownership" 으로 거부한다(codex-cli 0.163.0 에서 확인). 사용자가 정한 데이터 위치 하나만
 * 명령줄 설정으로 허용하고, 사용자 작업 저장소에는 손대지 않는다.
 */
export function ownershipOverride(cwd) {
  if (!cwd) return []
  const dir = slash(cwd)
  return same(dir, slash(projectRoot())) ? ['-c', `safe.directory=${dir}`] : []
}

/**
 * git 을 셸 없이 인자 배열로 실행한다. 경로가 따옴표·8진수로 바뀌지 않게 core.quotepath 를 끈다.
 * stdout 은 Buffer 로 돌려준다(파일 내용을 바이트 그대로 다뤄야 해서).
 */
export function git(cwd, args, { input, allowFail = false, env } = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...ownershipOverride(cwd), ...args], {
    cwd,
    input,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  })
  if (r.error) throw new PmError(`git 을 실행할 수 없습니다 — ${r.error.message}`)
  const result = { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') }
  if (r.status !== 0 && !allowFail) {
    throw new PmError(`git ${args[0]} 실패 — ${result.stderr.trim() || `종료 코드 ${r.status}`}`)
  }
  return result
}

export function gitText(cwd, args, options) {
  return git(cwd, args, options).stdout.toString('utf8')
}
