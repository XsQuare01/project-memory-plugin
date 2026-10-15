import { pmRoot } from '../lib/root.mjs'
import { out } from '../lib/cli.mjs'
import { pendingJournals } from '../lib/journal.mjs'
import { withLock } from '../lib/tx.mjs'

/** 남은 작업 기록을 보여 주고 처리한다(쓰기 명령이 잠금을 잡을 때 하는 것과 같은 복구). */
export async function run() {
  const root = pmRoot()
  const before = pendingJournals(root).map(j => j.txId)
  if (!before.length) {
    out('남은 작업 기록 없음')
    return 0
  }
  withLock(root, { agent: 'user', session: 'recover' }, () => {})
  const left = pendingJournals(root).map(j => j.txId)
  out(`처리한 작업 기록: ${before.filter(id => !left.includes(id)).join(', ') || '없음'}`)
  if (left.length) out(`남은 작업 기록: ${left.join(', ')} — runtime/journal/ 을 확인하세요`)
  return left.length ? 1 : 0
}
