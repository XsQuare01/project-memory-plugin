import { pmRoot } from '../lib/root.mjs'
import { parseArgs, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { forceUnlock } from '../lib/lock.mjs'

export async function run(argv) {
  const { values } = parseArgs(argv, { force: { type: 'boolean' } })
  if (!values.force) throw new PmError('잠금을 강제로 풀려면 --force 를 주세요 — 다른 작업이 쓰는 중이 아닌지 먼저 확인하세요', 2)
  const removed = forceUnlock(pmRoot())
  out(removed.length ? `해제: ${removed.join(', ')}` : '잡힌 잠금 없음')
  return 0
}
