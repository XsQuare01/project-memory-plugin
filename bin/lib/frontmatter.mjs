import { createRequire } from 'node:module'

// yaml 은 문서를 실제로 읽을 때만 불러온다(훅의 빠른 경로에서 수십 ms 를 아낀다).
const require = createRequire(import.meta.url)
let yamlLib = null
const YAML = {
  parse: text => (yamlLib ??= require('yaml')).parse(text),
  stringify: (value, options) => (yamlLib ??= require('yaml')).stringify(value, options),
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** 문서를 머리말(data)과 본문(body)으로 나눈다. 머리말이 없으면 data 는 null. CRLF 도 읽는다. */
export function parseDoc(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input
  const m = FRONT.exec(text)
  if (!m) return { data: null, body: text }
  let data
  try {
    data = YAML.parse(m[1]) ?? {}
  } catch (err) {
    return { data: null, body: text, error: `머리말을 읽을 수 없습니다 — ${err.message.split('\n')[0]}` }
  }
  return { data, body: text.slice(m[0].length) }
}

export function serializeDoc(data, body) {
  return `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n${body}`
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const EVIDENCE_KEYS = ['source', 'decision', 'knowledge', 'user']

/** 경로(프로젝트 폴더 기준)로 문서 종류를 정한다. 문서가 아니면 null. */
export function docKind(rel) {
  if (rel === 'project.md') return 'project'
  const m = /^(knowledge|decisions|questions)\/[^/]+\.md$/.exec(rel)
  if (!m) return null
  return { knowledge: 'knowledge', decisions: 'decision', questions: 'question' }[m[1]]
}

const asDate = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v)

/** 머리말 형식 오류 목록. 근거가 실제로 있는지는 여기서 보지 않는다(apply 가 본다). */
export function validateDoc(rel, data) {
  const kind = docKind(rel)
  if (!kind) return []
  if (!data || typeof data !== 'object') return ['머리말이 없습니다']
  const errors = []
  if (typeof data.title !== 'string' || !data.title.trim()) errors.push('title 이 비어 있습니다')
  if (typeof data.summary !== 'string' || !data.summary.trim()) errors.push('summary 가 비어 있습니다')
  else if (/[\r\n]/.test(data.summary)) errors.push('summary 는 한 줄이어야 합니다')
  else if ([...data.summary].length > 120) errors.push('summary 는 120자 이내여야 합니다')
  if (kind === 'project') return errors

  if (data.type !== kind) errors.push(`type 은 ${kind} 이어야 합니다`)
  const statuses = { knowledge: ['proposed', 'confirmed'], decision: ['active', 'superseded'], question: ['open', 'resolved'] }[kind]
  if (!statuses.includes(data.status)) errors.push(`status 는 ${statuses.join(' | ')} 중 하나여야 합니다`)

  if (kind === 'knowledge') {
    if (!Array.isArray(data.evidence) || data.evidence.length === 0) errors.push('evidence 가 비어 있습니다')
  }
  if (data.evidence !== undefined && data.evidence !== null) {
    if (!Array.isArray(data.evidence)) errors.push('evidence 는 목록이어야 합니다')
    else for (const entry of data.evidence) {
      const keys = entry && typeof entry === 'object' ? Object.keys(entry) : []
      if (keys.length !== 1 || !EVIDENCE_KEYS.includes(keys[0]) || typeof entry[keys[0]] !== 'string') {
        errors.push(`evidence 항목은 ${EVIDENCE_KEYS.join('·')} 중 하나의 키와 문자열 값이어야 합니다`)
        break
      }
    }
  }
  if (kind === 'decision') {
    if (!DATE.test(asDate(data.date) ?? '')) errors.push('date 는 YYYY-MM-DD 여야 합니다')
    if (typeof data.decided_by !== 'string' || !data.decided_by.trim()) errors.push('decided_by 가 비어 있습니다')
  }
  if (kind === 'question') {
    if (!DATE.test(asDate(data.asked) ?? '')) errors.push('asked 는 YYYY-MM-DD 여야 합니다')
  }
  return errors
}
