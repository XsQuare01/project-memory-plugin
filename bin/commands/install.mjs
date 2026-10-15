import { parseArgs, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { planClaude, applyPlan, claudeHome } from '../lib/install-claude.mjs'

const PLUGIN_GUIDE = `Claude Code 에는 플러그인으로 설치합니다:
  /plugin marketplace add <이 플러그인 폴더 또는 GitHub 저장소>
  /plugin install project-memory@project-memory
플러그인 이전의 수동 설치를 걷어 내려면: pm install claude --remove [--dry-run]`

/** pm install claude --remove [--dry-run] — 플러그인 이전의 수동 설치를 걷어 낸다. */
export async function run(argv) {
  const { values, positionals } = parseArgs(argv, { 'dry-run': { type: 'boolean' }, remove: { type: 'boolean' } })
  const [tool] = positionals
  if (tool !== 'claude' || !values.remove) throw new PmError(PLUGIN_GUIDE, 2)
  const plan = planClaude({ remove: true })
  out(`걷어 낼 곳: ${claudeHome()}`)
  if (!plan.length) {
    out('바꿀 것 없음 — 옛 수동 설치가 없습니다')
    return 0
  }
  for (const p of plan) out(`- ${p.label}: ${p.path}${p.after === null ? ' (삭제)' : ''}`)
  if (values['dry-run']) {
    out('(--dry-run: 아무것도 바꾸지 않았습니다)')
    return 0
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const backups = applyPlan(plan, stamp)
  if (backups.length) out(`백업: ${backups.join(', ')}`)
  out('걷어 냈습니다. 플러그인을 설치했다면 새 세션부터 플러그인 훅이 동작합니다.')
  return 0
}
