import { pmRoot } from '../lib/root.mjs'
import { parseArgs, sessionOf, out } from '../lib/cli.mjs'
import { unlink } from '../lib/link.mjs'
import { rebuildViewerQuietly } from '../lib/viewer.mjs'

/** pm unlink — 지금 브랜치의 연결을 지운다. */
export async function run(argv) {
  const { values } = parseArgs(argv)
  const root = pmRoot()
  const r = unlink(root, { ...sessionOf(values), cwd: process.cwd() })
  out(`연결 해제: ${r.label}`)
  rebuildViewerQuietly(root)
  return 0
}
