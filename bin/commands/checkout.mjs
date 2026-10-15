import { pmRoot } from '../lib/root.mjs'
import { parseArgs, sessionOf, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { checkout, refresh } from '../lib/drafts.mjs'
import { projectForCommand } from '../lib/project-context.mjs'
import { recoverIfPending } from '../lib/tx.mjs'

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    new: { type: 'boolean' },
    delete: { type: 'boolean' },
    refresh: { type: 'boolean' },
  })
  if (!positionals.length) throw new PmError('사용법: pm checkout <프로젝트 상대 경로…> [--new | --delete | --refresh]', 2)
  if ([values.new, values.delete, values.refresh].filter(Boolean).length > 1) throw new PmError('--new·--delete·--refresh 는 하나만 줄 수 있습니다', 2)
  const root = pmRoot()
  const s = sessionOf(values)
  const { project } = projectForCommand(root, values, s)
  recoverIfPending(root, s)

  if (values.refresh) {
    for (const r of refresh(root, { ...s, project, paths: positionals })) {
      out(`${r.conflicted ? '충돌 표시 있음' : '병합됨'}: ${r.rel}`)
      out(`  변경안: ${r.draftPath}`)
      out(`  이전 기준본: ${r.prevBasePath}`)
      out(`  이전 변경안: ${r.prevDraftPath}`)
      if (r.note) out(`  참고: ${r.note}`)
    }
    return 0
  }
  const mode = values.new ? 'new' : values.delete ? 'delete' : 'edit'
  for (const e of checkout(root, { ...s, project, paths: positionals, mode })) {
    out(mode === 'delete' ? `삭제 예정: ${e.rel}` : `변경안: ${e.draftPath}`)
  }
  return 0
}
