import { spawnSync } from 'node:child_process'
import { PmError } from './errors.mjs'

/**
 * git 을 셸 없이 인자 배열로 실행한다. 경로가 따옴표·8진수로 바뀌지 않게 core.quotepath 를 끈다.
 * stdout 은 Buffer 로 돌려준다(파일 내용을 바이트 그대로 다뤄야 해서).
 */
export function git(cwd, args, { input, allowFail = false, env } = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
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
