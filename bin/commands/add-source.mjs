import { resolve } from 'node:path'
import { pmRoot } from '../lib/root.mjs'
import { parseArgs, sessionOf, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { addSource } from '../lib/sources.mjs'
import { projectForCommand } from '../lib/project-context.mjs'
import { rebuildViewerQuietly } from '../lib/viewer.mjs'

/** pm add-source <원본 경로> --as <자료 이름> [--date YYYY-MM-DD] [--note …] */
export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    as: { type: 'string' },
    date: { type: 'string' },
    note: { type: 'string' },
  })
  const [from] = positionals
  if (!from || !values.as) throw new PmError('사용법: pm add-source <원본 경로> --as <자료 이름> [--date YYYY-MM-DD] [--note …]', 2)
  const root = pmRoot()
  const s = sessionOf(values)
  const { project } = projectForCommand(root, values, s)
  const r = addSource(root, { ...s, project, from: resolve(from), as: values.as, date: values.date, note: values.note })
  out(`자료 추가: ${r.ref} (파일 ${r.files}개${r.commit ? `, 커밋 ${r.commit.slice(0, 9)}` : ''})`)
  out(`근거로 쓸 때: evidence: [{ source: ${r.ref} }]`)
  out('원본은 그대로 두었습니다 — 지우는 것은 사용자가 정합니다')
  rebuildViewerQuietly(root)
  return 0
}
