// 사용자 메모리 저장소 (설계 ②·③). git 없는 개인 전용 폴더, 항목 하나 = 파일 하나.
// 쓰기는 잠금 안에서 판번호를 비교하고 원자적으로 쓴다. 삭제는 표시를 먼저 남겨, 도중에 끝나도 읽는 쪽이 제외한다.
import { readdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PmError } from './errors.mjs'
import { personalRoot } from './roots.mjs'
import { atomicWrite, readJson, writeJson } from './fsx.mjs'
import { parseDoc, serializeDoc } from './frontmatter.mjs'
import { isValidProjectName } from './names.mjs'
import { acquireLock, releaseLock } from './lock.mjs'
import { fault } from './tx.mjs'
import { localToday } from './apply.mjs'

export const meRoot = () => personalRoot()

const KINDS = ['background', 'preference', 'person', 'environment']
const SCOPE = /^(global|(company|project):[a-z0-9]+(-[a-z0-9]+)*)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const FORGET_KEEP_MS = 7 * 24 * 3600 * 1000
export const CORE_LIMIT = 600

const itemsDir = root => join(root, 'items')
const forgottenDir = root => join(root, 'forgotten')
const itemPath = (root, id) => join(itemsDir(root), `${id}.md`)
const markPath = (root, id) => join(forgottenDir(root), `${id}.json`)
const str = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v)

export function validateItem(d) {
  const e = []
  if (!isValidProjectName(d.id)) e.push('id 는 영문 소문자·숫자·하이픈, 40자 이내여야 합니다')
  if (typeof d.text !== 'string' || !d.text.trim()) e.push('text 가 비어 있습니다')
  else if (/[\r\n]/.test(d.text)) e.push('text 는 한 줄이어야 합니다')
  else if ([...d.text].length > 120) e.push('text 는 120자 이내여야 합니다')
  if (!KINDS.includes(d.kind)) e.push(`kind 는 ${KINDS.join(' | ')} 중 하나여야 합니다`)
  if (!SCOPE.test(d.scope ?? '')) e.push('scope 는 global, company:<이름>, project:<이름> 중 하나여야 합니다')
  if (d.core && d.scope !== 'global') e.push('core 는 scope 가 global 인 항목에만 쓸 수 있습니다')
  if (typeof d.source !== 'string' || !d.source.trim()) e.push('source(근거)가 비어 있습니다')
  for (const k of ['confirmed', 'updated']) if (!DATE.test(str(d[k]) ?? '')) e.push(`${k} 는 YYYY-MM-DD 여야 합니다`)
  if (d.review_after && !DATE.test(str(d.review_after))) e.push('review_after 는 YYYY-MM-DD 여야 합니다')
  if (!Number.isInteger(d.revision) || d.revision < 1) e.push('revision 은 1 이상의 정수여야 합니다')
  if (typeof d.updated_by !== 'string' || !d.updated_by) e.push('updated_by 가 비어 있습니다')
  return e
}

export function readTombstones(root) {
  if (!existsSync(forgottenDir(root))) return []
  return readdirSync(forgottenDir(root)).filter(f => f.endsWith('.json')).map(f => readJson(join(forgottenDir(root), f), null)).filter(Boolean)
}

/** 삭제 표시가 없는 항목. withInvalid 면 형식이 깨진 항목도 errors 와 함께 돌려준다. */
export function readItems(root, { withInvalid = false } = {}) {
  if (!existsSync(itemsDir(root))) return []
  const forgotten = new Set(readTombstones(root).map(t => t.id))
  const out = []
  for (const f of readdirSync(itemsDir(root)).filter(n => n.endsWith('.md')).sort()) {
    const id = f.slice(0, -3)
    if (forgotten.has(id)) continue
    const { data, body } = parseDoc(readFileSync(join(itemsDir(root), f)))
    const d = data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)])) : {}
    const errors = data ? validateItem(d) : ['머리말이 없습니다']
    if (d.id !== id) errors.push('id 가 파일 이름과 다릅니다')
    if (errors.length && !withInvalid) {
      process.stderr.write(`pm: 사용자 메모리 항목 ${f} 를 건너뜁니다 — ${errors[0]}\n`)
      continue
    }
    out.push({ id, data: d, body: body ?? '', ...(errors.length ? { errors } : {}) })
  }
  return out
}

/** 핵심 항목 줄들(주입되는 모양). 600자 검사에 쓴다. */
export const coreBlock = items => items.filter(i => i.data.core && i.data.scope === 'global').map(i => `- ${i.data.text}`).join('\n')

/** 잠금 안에서: 끝나지 않은 삭제를 마저 하고 오래된 표시를 정리한 뒤 fn 을 실행한다. */
function withMeLock(root, by, fn) {
  const { token } = acquireLock(root, { agent: by, session: 'me' })
  try {
    const now = Date.now()
    for (const t of readTombstones(root)) {
      rmSync(itemPath(root, t.id), { force: true })
      if (now - Date.parse(t.at) > FORGET_KEEP_MS) rmSync(markPath(root, t.id), { force: true })
    }
    return fn()
  } finally {
    releaseLock(root, token)
  }
}

const ORDER = ['id', 'text', 'kind', 'scope', 'core', 'source', 'confirmed', 'updated', 'revision', 'review_after', 'updated_by']

function writeItem(root, data, body, current) {
  const clean = Object.fromEntries(ORDER.filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '').map(k => [k, data[k]]))
  const errors = validateItem(clean)
  if (errors.length) throw new PmError(`항목 '${clean.id}' — ${errors.join('; ')}`, 2)
  const after = [...current.filter(i => i.id !== clean.id), { id: clean.id, data: clean }]
  const core = coreBlock(after)
  if (clean.core && core.length > CORE_LIMIT) {
    throw new PmError(`핵심 항목 합계가 ${core.length}자로 ${CORE_LIMIT}자를 넘습니다 — 다른 핵심 항목을 줄이거나 이 항목을 핵심이 아닌 것으로 두세요`, 2)
  }
  atomicWrite(itemPath(root, clean.id), Buffer.from(serializeDoc(clean, body ?? '')))
  return { id: clean.id, data: clean }
}

export function remember(root, { by, id, text, kind, scope, core = false, source, reviewAfter, body, today = localToday() }) {
  return withMeLock(root, by, () => {
    if (existsSync(itemPath(root, id)) || readTombstones(root).some(t => t.id === id)) {
      throw new PmError(`항목 '${id}' 가 이미 있습니다(또는 최근에 지웠습니다) — 고치려면 pm me edit/confirm, 다른 id 를 쓰세요`)
    }
    const data = { id, text, kind, scope, core: Boolean(core), source, confirmed: today, updated: today, revision: 1, review_after: reviewAfter, updated_by: by }
    return writeItem(root, data, body, readItems(root))
  })
}

/** confirm=false 면 edit(확인일 그대로), true 면 confirm(확인일 오늘). base 는 읽었을 때의 판번호. */
export function editItem(root, { by, id, base, confirm = false, text, kind, scope, core, source, reviewAfter, body, today = localToday() }) {
  return withMeLock(root, by, () => {
    const items = readItems(root)
    const item = items.find(i => i.id === id)
    if (!item) throw new PmError(`항목 '${id}' 가 없습니다`)
    if (!Number.isInteger(base)) throw new PmError('--base <읽었을 때의 판번호> 가 필요합니다', 2)
    if (item.data.revision !== base) {
      throw new PmError(`항목 '${id}' 의 판번호가 ${item.data.revision} 입니다(받은 기준 ${base}) — 다시 읽고 고치세요`, 3)
    }
    const data = {
      ...item.data,
      ...(text !== undefined ? { text } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(core !== undefined ? { core } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(reviewAfter !== undefined ? { review_after: reviewAfter } : {}),
      updated: today,
      revision: item.data.revision + 1,
      updated_by: by,
      ...(confirm ? { confirmed: today } : {}),
    }
    return writeItem(root, data, body ?? item.body, items)
  })
}

export function forget(root, { by, id }) {
  return withMeLock(root, by, () => {
    const item = readItems(root).find(i => i.id === id)
    if (!item) throw new PmError(`항목 '${id}' 가 없습니다`)
    writeJson(markPath(root, id), { id, revision: item.data.revision, at: new Date().toISOString(), by })
    fault('me-forget-after-mark')
    rmSync(itemPath(root, id), { force: true })
    return { id, revision: item.data.revision }
  })
}

const migratedPath = root => join(root, 'migrated.json')

export function recordMigration(root, { source, partSha, item }) {
  const list = readJson(migratedPath(root), [])
  if (!list.some(m => m.source === source && m.partSha === partSha)) list.push({ source, partSha, item, at: new Date().toISOString() })
  writeJson(migratedPath(root), list)
}

export function isMigrated(root, { source, partSha }) {
  return readJson(migratedPath(root), []).some(m => m.source === source && m.partSha === partSha)
}
