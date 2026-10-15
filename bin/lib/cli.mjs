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

/** --agent·--session 이 없으면 PM_AGENT·PM_SESSION 환경 변수를 쓴다. */
export function sessionOf(values) {
  const agent = values.agent ?? process.env.PM_AGENT
  const session = values.session ?? process.env.PM_SESSION
  if (!agent || !session) throw new PmError('--agent 와 --session 이 필요합니다 (훅이 주입한 세션 정보를 쓰세요)', 2)
  return { agent, session }
}

export function out(line = '') {
  process.stdout.write(`${line}\n`)
}
