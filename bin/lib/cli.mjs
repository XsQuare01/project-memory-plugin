// 명령 인자 해석과 명령들이 함께 쓰는 도움 함수.
import { parseArgs as nodeParseArgs } from 'node:util'
import { PmError } from './errors.mjs'

/** node:util parseArgs 를 감싸 한국어 오류(종료 코드 2)로 바꾼다. 공통 옵션 agent·session·project 는 늘 받는다. */
export function parseArgs(argv, options = {}) {
  try {
    return nodeParseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        agent: { type: 'string' },
        session: { type: 'string' },
        project: { type: 'string' },
        ...options,
      },
    })
  } catch (err) {
    throw new PmError(`인자 오류 — ${err.message}`, 2)
  }
}

/**
 * --agent·--session 이 없으면 PM_AGENT·PM_SESSION 환경 변수를 쓴다.
 * Codex 는 에이전트가 실행하는 명령에 CODEX_THREAD_ID 를 넣어 주며, 이 값이 훅 입력의 session_id 와 같다
 * (codex-cli 0.163.0 에서 확인). 그래서 --agent codex 이면 --session 을 생략할 수 있다.
 */
export function sessionOf(values) {
  const found = findSession(values)
  if (!found) throw new PmError('--agent 와 --session 이 필요합니다 (훅이 주입한 세션 정보를 쓰세요)', 2)
  return found
}

/** sessionOf 와 같되, 없으면 null(세션이 선택 사항인 명령용). 빈 환경 변수는 없는 것으로 본다. */
export function findSession(values) {
  const agent = values.agent ?? (process.env.PM_AGENT || undefined)
  const session = values.session ?? (process.env.PM_SESSION || (agent === 'codex' ? process.env.CODEX_THREAD_ID : undefined) || undefined)
  return agent && session ? { agent, session } : null
}

export function out(line = '') {
  process.stdout.write(`${line}\n`)
}
