import { pmRoot } from '../lib/root.mjs'
import { parseArgs, sessionOf, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { link } from '../lib/link.mjs'
import { assertProjectExists } from '../lib/project-context.mjs'
import { rebuildViewerQuietly } from '../lib/viewer.mjs'

/** pm link <프로젝트> — 지금 저장소의 지금 브랜치를 프로젝트에 연결한다. */
export async function run(argv) {
  const { values, positionals } = parseArgs(argv)
  const [project] = positionals
  if (!project) throw new PmError('사용법: pm link <프로젝트>', 2)
  const root = pmRoot()
  const s = sessionOf(values)
  assertProjectExists(root, project)
  const r = link(root, { ...s, cwd: process.cwd(), project })
  out(`연결: ${r.label} → ${project}${r.repo.id ? '' : ' (원격이 없어 links.json 에는 남기지 않았습니다 — pm register-repo 로 ID 를 붙일 수 있습니다)'}`)
  rebuildViewerQuietly(root)
  return 0
}
