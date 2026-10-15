import { pmRoot } from '../lib/root.mjs'
import { parseArgs, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { assertProjectName } from '../lib/names.mjs'
import { pinHead, readProject } from '../lib/snapshot.mjs'
import { buildToc } from '../lib/inject.mjs'

/** pm toc <프로젝트> — 커밋된 내용 기준 전체 목차. */
export async function run(argv) {
  const { positionals } = parseArgs(argv)
  const [project] = positionals
  if (!project) throw new PmError('사용법: pm toc <프로젝트>', 2)
  assertProjectName(project)
  const root = pmRoot()
  const snap = readProject(root, pinHead(root), project)
  if (!snap.exists) throw new PmError(`프로젝트 '${project}' 가 없습니다(커밋된 내용 기준)`)
  out(buildToc(project, snap.projectDoc, snap.docs))
  return 0
}
