import { parseArgs, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { meRoot, readItems, remember, editItem, forget, recordMigration, isMigrated } from '../lib/me-store.mjs'
import { localToday } from '../lib/apply.mjs'
import { rebuildViewerQuietly } from '../lib/viewer.mjs'
import { pmRoot } from '../lib/root.mjs'

const USAGE = `사용법: pm me <remember|edit|confirm|forget|list|migrated> …
  remember --id <id> --text <한 줄> --kind <background|preference|person|environment> --scope <global|company:x|project:x> --source <근거> [--core] [--review-after YYYY-MM-DD]
  edit <id> --base <판번호> [--text …] [--kind …] [--scope …] [--core | --no-core] [--source …] [--review-after …]   (확인일 그대로)
  confirm <id> --base <판번호> [--text …] [--source …]   (사용자가 확인·정정 — 확인일 오늘)
  forget <id>
  list [--scope <범위>]
  migrated --source <원본 경로> --part-sha <지문> [--item <id>]   (기록, --check 면 확인만)`

const OPTIONS = {
  id: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string' }, scope: { type: 'string' },
  source: { type: 'string' }, core: { type: 'boolean' }, 'no-core': { type: 'boolean' },
  'review-after': { type: 'string' }, base: { type: 'string' }, item: { type: 'string' },
  'part-sha': { type: 'string' }, check: { type: 'boolean' },
}

const by = v => `${v.agent ?? process.env.PM_AGENT ?? 'user'}/${v.session ?? process.env.PM_SESSION ?? 'cli'}`
const baseOf = v => (v.base === undefined ? undefined : Number(v.base))
const coreOf = v => (v.core ? true : v['no-core'] ? false : undefined)

export async function run(argv) {
  const [sub, ...rest] = argv
  const { values, positionals } = parseArgs(rest, OPTIONS)
  const root = meRoot()
  const id = positionals[0] ?? values.id
  switch (sub) {
    case 'remember': {
      const item = remember(root, { by: by(values), id, text: values.text, kind: values.kind, scope: values.scope, core: values.core, source: values.source, reviewAfter: values['review-after'] })
      out(`사용자 메모리 기록: ${item.id} (${item.data.scope}${item.data.core ? ', 핵심' : ''})`)
      break
    }
    case 'edit':
    case 'confirm': {
      if (!id) throw new PmError(USAGE, 2)
      const item = editItem(root, {
        by: by(values), id, base: baseOf(values), confirm: sub === 'confirm',
        text: values.text, kind: values.kind, scope: values.scope, core: coreOf(values), source: values.source, reviewAfter: values['review-after'],
      })
      out(`사용자 메모리 ${sub === 'confirm' ? '확인' : '수정'}: ${item.id} (판번호 ${item.data.revision})`)
      break
    }
    case 'forget': {
      if (!id) throw new PmError(USAGE, 2)
      forget(root, { by: by(values), id })
      out(`사용자 메모리에서 지움: ${id} — 저장 목록·뷰어·이후 주입에서 빠집니다(이미 전달된 대화 속 내용은 회수되지 않습니다)`)
      break
    }
    case 'list': {
      const today = localToday()
      const items = readItems(root).filter(i => !values.scope || i.data.scope === values.scope)
      if (!items.length) out('사용자 메모리 항목 없음')
      for (const i of items) {
        const stale = i.data.review_after && i.data.review_after < today ? ' (재확인 필요)' : ''
        out(`- ${i.id} [${i.data.scope}${i.data.core ? ', 핵심' : ''}, 판번호 ${i.data.revision}, 확인 ${i.data.confirmed}]${stale} — ${i.data.text}`)
      }
      return 0
    }
    case 'migrated': {
      if (!values.source || !values['part-sha']) throw new PmError(USAGE, 2)
      if (values.check) {
        out(isMigrated(root, { source: values.source, partSha: values['part-sha'] }) ? '이관됨' : '이관 안 됨')
        return 0
      }
      recordMigration(root, { source: values.source, partSha: values['part-sha'], item: values.item })
      out(`이관 기록: ${values.source} → ${values.item ?? '(옮기지 않음)'}`)
      return 0
    }
    default:
      throw new PmError(USAGE, 2)
  }
  rebuildViewerQuietly(pmRoot())
  return 0
}
