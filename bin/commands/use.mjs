import { pmRoot } from '../lib/root.mjs'
import { parseArgs, sessionOf, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { updateState, readState } from '../lib/session.mjs'
import { assertProjectExists } from '../lib/project-context.mjs'

/** pm use <프로젝트> | --clear — 이 세션에서 쓸 프로젝트(세션 ID 에만 적용). */
export async function run(argv) {
  const { values, positionals } = parseArgs(argv, { clear: { type: 'boolean' } })
  const root = pmRoot()
  const s = sessionOf(values)
  // 세션 폴더는 훅이 기록한다. 훅보다 먼저 부른 경우(사람이 직접)에만 지금 폴더를 쓴다.
  const cwd = readState(root, s.agent, s.session).cwd ?? process.cwd()
  if (values.clear) {
    updateState(root, s.agent, s.session, { selection: null, cwd })
    out('세션 선택을 해제했습니다 — 이제 브랜치 연결이 있으면 그것을 씁니다')
    return 0
  }
  const [project] = positionals
  if (!project) throw new PmError('사용법: pm use <프로젝트> | --clear', 2)
  assertProjectExists(root, project)
  updateState(root, s.agent, s.session, { selection: { project, at: new Date().toISOString() }, cwd })
  out(`이 세션(${s.agent}/${s.session})은 프로젝트 ${project} 를 씁니다 — 다음 메시지부터 문맥이 들어갑니다`)
  return 0
}
