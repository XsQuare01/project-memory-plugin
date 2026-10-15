// 훅 입출력. 훅은 세션을 막으면 안 되므로 어떤 오류에도 출력 없이 0 으로 끝난다(오류는 stderr 로만).
import { readFileSync } from 'node:fs'
import { parseArgs } from './cli.mjs'
import { pmRoot } from './root.mjs'
import { rememberRoots } from './roots.mjs'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

export function runHook(argv, eventName, produce) {
  try {
    const { values } = parseArgs(argv, { cap: { type: 'string' } })
    const agent = values.agent
    const raw = readStdin().trim()
    if (!agent || !raw) return 0
    let input
    try {
      input = JSON.parse(raw)
    } catch {
      process.stderr.write('pm: 훅 입력이 JSON 이 아닙니다 — 주입하지 않습니다\n')
      return 0
    }
    if (typeof input?.session_id !== 'string' || !input.session_id) return 0
    rememberRoots()
    const cap = values.cap ? Number(values.cap) : undefined
    // Claude 의 입력 cwd 는 에이전트가 cd 할 때마다 바뀐다. 세션을 시작한 폴더(CLAUDE_PROJECT_DIR)로 판정해야
    // 에이전트가 다른 폴더를 오가도 연결이 유지된다(공식 문서: 이 값은 cd 해도 그대로다).
    const cwd = (agent === 'claude' && process.env.CLAUDE_PROJECT_DIR) || input.cwd
    const text = produce(pmRoot(), { agent, session: input.session_id, cwd, ...(cap ? { cap } : {}) })
    if (text) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || eventName, additionalContext: text } }))
    }
  } catch (err) {
    process.stderr.write(`pm: 훅 처리 중 오류 — 주입하지 않습니다 (${err?.message ?? err})\n`)
  }
  return 0
}
