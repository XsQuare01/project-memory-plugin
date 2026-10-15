import { pmRoot } from '../lib/root.mjs'
import { parseArgs, sessionOf, out } from '../lib/cli.mjs'
import { apply } from '../lib/apply.mjs'
import { projectForCommand } from '../lib/project-context.mjs'
import { rebuildViewerQuietly } from '../lib/viewer.mjs'

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    message: { type: 'string', short: 'm' },
    confirm: { type: 'string' },
  })
  const root = pmRoot()
  const s = sessionOf(values)
  const { project, via } = projectForCommand(root, values, s)
  const r = apply(root, { ...s, project, via, message: values.message, confirm: values.confirm, paths: positionals })
  if (!r.txId) out('변경 없음 — 변경안을 정리했습니다')
  else out(`반영: ${r.commit.slice(0, 9)} (${r.files.join(', ')})`)
  rebuildViewerQuietly(root)
  return 0
}
