import { join } from 'node:path'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { pmRoot } from '../lib/root.mjs'
import { parseArgs, out } from '../lib/cli.mjs'
import { readJson } from '../lib/fsx.mjs'
import { pinHead } from '../lib/snapshot.mjs'
import { pendingJournals } from '../lib/journal.mjs'
import { sessionsRoot, readState } from '../lib/session.mjs'
import { previewFor } from '../lib/hooks.mjs'
import { repoInfo } from '../lib/repo.mjs'

const PRUNE_DAYS = 30

/** pm status [--agent --session] [--prune] — 지금 상태, 주입될 글 미리보기, 정리할 것. */
export async function run(argv) {
  const { values } = parseArgs(argv, { prune: { type: 'boolean' } })
  const root = pmRoot()
  out(`저장소: ${root}`)
  out(`HEAD: ${pinHead(root) ?? '(커밋 없음)'}`)
  const journals = pendingJournals(root)
  out(`남은 작업 기록: ${journals.length ? journals.map(j => j.txId).join(', ') + ' — pm recover' : '없음'}`)
  out(`잠금: ${existsSync(join(root, 'runtime', 'lock')) ? '잡혀 있음' : '없음'}${existsSync(join(root, 'runtime', 'lock.reclaim')) ? ' · 회수 잠금 남음(pm unlock --force)' : ''}`)

  const repo = repoInfo(process.cwd(), root)
  const links = readJson(join(root, 'links.json'), {})
  out('', )
  out(`브랜치 연결(links.json): ${Object.keys(links).length}개`)
  for (const [key, v] of Object.entries(links)) {
    let mark = ''
    if (repo?.id && key.startsWith(`${repo.id}@`)) {
      const branch = key.slice(repo.id.length + 1)
      mark = repo.links[branch] === v.project ? ' (이 저장소에서 확인됨)' : ' (이 저장소에 해당 브랜치 설정이 없음 — 브랜치가 지워졌다면 정리 대상)'
    }
    out(`- ${key} → ${v.project}${mark}`)
  }

  if (values.agent && values.session) {
    const state = readState(root, values.agent, values.session)
    const delivered = Object.entries(state.me_delivered ?? {}).map(([id, rev]) => `${id}@${rev}`)
    out('')
    out(`이 세션에 전달한 과제: ${state.last_injected ? `${state.last_injected.project}@${state.last_injected.revision?.slice(0, 9)}` : '없음'}`)
    out(`전달한 사용자 메모리: ${delivered.length ? delivered.join(', ') : '없음'}`)
    const { resolved, text } = previewFor(root, { agent: values.agent, session: values.session, cwd: state.cwd ?? process.cwd() })
    out(`지금 다시 계산한 판정: ${resolved ? `${resolved.project} (${resolved.via})` : '없음'}`)
    if (text) out(`--- 지금 계산하면 주입될 글 (${text.length}자) ---\n${text}\n---`)
  }

  const base = sessionsRoot(root)
  const kept = []
  let pruned = 0
  if (existsSync(base)) {
    const cutoff = Date.now() - PRUNE_DAYS * 24 * 3600 * 1000
    for (const agent of readdirSync(base)) {
      for (const session of readdirSync(join(base, agent))) {
        const dir = join(base, agent, session)
        const state = readJson(join(dir, 'state.json'), {})
        const drafts = Object.keys(readJson(join(dir, 'drafts.json'), {}))
        const updated = Date.parse(state.updated ?? '') || 0
        if (updated >= cutoff) continue
        if (drafts.length) kept.push(`${agent}/${session} (변경안 ${drafts.length}개)`)
        else if (values.prune) {
          rmSync(dir, { recursive: true, force: true })
          pruned++
        }
      }
    }
  }
  out('')
  if (values.prune) out(`정리한 세션: ${pruned}개 (${PRUNE_DAYS}일 지난 것, 변경안 없음)`)
  if (kept.length) out(`변경안이 남아 정리하지 않은 오래된 세션: ${kept.join(', ')}`)
  return 0
}
