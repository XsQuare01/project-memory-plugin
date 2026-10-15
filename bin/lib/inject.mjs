// 주입 글·목차 만들기 (설계 5.1). 순수 함수 — 읽기는 snapshot.mjs 가 한다.
import { docKind } from './frontmatter.mjs'

export function oneLine(s, max = 120) {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat
}

const slugOf = rel => rel.split('/').pop().replace(/\.md$/, '')
const dateOf = d => (d.data.date instanceof Date ? d.data.date.toISOString().slice(0, 10) : String(d.data.date ?? ''))

/** 주입 순서대로 절을 만든다: active 결정(최신순) → confirmed 이해 → 열린 질문 → proposed. */
export function sections(docs) {
  const byKind = (kind, status) => docs.filter(d => docKind(d.rel) === kind && d.data.status === status)
  const decisions = byKind('decision', 'active')
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || a.rel.localeCompare(b.rel))
    .map(d => `- ${dateOf(d)} ${slugOf(d.rel).replace(/^\d{4}-\d{2}-\d{2}-/, '')} — ${oneLine(d.data.summary)}`)
  const line = d => `- ${slugOf(d.rel)} — ${oneLine(d.data.summary)}`
  const byName = (a, b) => a.rel.localeCompare(b.rel)
  return [
    { heading: '결정 (active, 최신순)', items: decisions },
    { heading: '이해 (confirmed)', items: byKind('knowledge', 'confirmed').sort(byName).map(line) },
    { heading: '열린 질문', items: byKind('question', 'open').sort(byName).map(line) },
    { heading: '제안 (proposed — 확인 전 해석)', items: byKind('knowledge', 'proposed').sort(byName).map(line) },
  ]
}

function projectBody(projectDoc) {
  if (!projectDoc?.body) return ''
  const lines = projectDoc.body.replace(/\r\n/g, '\n').split('\n').slice(0, 30).join('\n').trim()
  const chars = [...lines]
  return chars.length > 1500 ? `${chars.slice(0, 1499).join('')}…` : lines
}

export const PERSONAL_HEADER = '[사용자 메모리] 지금 요청이 우선한다 — 이번 한 번의 예외로 저장된 선호를 바꾸지 않는다. 충돌하면 프로젝트 > 회사 > 전역 순으로 따른다.'

/**
 * 사용자 메모리 항목을 주입 단계별로 나눈다(설계 ②). 같은 단계 안은 id 순.
 * 반환: { core, scoped, other } — 각 원소 { id, revision, updatedBy, line }.
 */
export function personalBlocks(items, { project, company, today }) {
  const toLine = i => ({
    id: i.id,
    revision: i.data.revision,
    updatedBy: i.data.updated_by,
    line: `- ${i.data.text}${i.data.review_after && i.data.review_after < today ? ' (재확인 필요)' : ''}`,
  })
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const pick = fn => items.filter(fn).sort(byId).map(toLine)
  return {
    core: pick(i => i.data.scope === 'global' && i.data.core),
    scoped: pick(i => (project && i.data.scope === `project:${project}`) || (company && i.data.scope === `company:${company}`)),
    other: pick(i => i.data.scope === 'global' && !i.data.core),
  }
}

/**
 * 상한(cap, 글자 수)을 절대 넘지 않는 주입 글(설계 5.1, 사용자 메모리 ②).
 * 순서: 사용자 핵심 → 과제 머리·개요 → 결정·확정 이해·열린 질문 → 이 과제·회사 범위 사용자 항목 → 제안 → 그 밖의 사용자 항목.
 * 생략 안내 자리를 먼저 확보하고, 항목은 자르지 않고 통째로 넣다가 안 들어가는 항목에서 멈춘다.
 * 반환: { text, included, omitted(과제), meIncluded, meOmitted, delivered: [{ id, revision }] }
 */
export function composeInjection({ cap, project = null, personal = null, tocCommand = 'pm toc', meListCommand = 'pm me list' }) {
  const secs = project ? sections(project.docs) : []
  const me = personal ?? { core: [], scoped: [], other: [] }
  const meTotal = me.core.length + me.scoped.length + me.other.length
  const total = secs.reduce((n, s) => n + s.items.length, 0)
  const omissionLine = (n, m) => {
    const parts = []
    if (n) parts.push(`과제 ${n}개 — ${tocCommand} 로 전체 보기`)
    if (m) parts.push(`사용자 메모리 ${m}개 — ${meListCommand}`)
    return `(생략: ${parts.join(' / ')})`
  }
  const budget = cap - (omissionLine(total, meTotal).length + 1)

  let text = ''
  const add = block => {
    const next = text ? `${text}\n${block}` : block
    if (next.length > budget) return false
    text = next
    return true
  }
  let full = false
  let included = 0
  const delivered = []
  // heading 은 첫 줄과 함께만 넣는다. 반환: 넣은 줄 수.
  const addBlock = (heading, lines, onAdd) => {
    if (full || !lines.length) return
    if (!add(heading ? `${heading}\n${lines[0].text}` : lines[0].text)) { full = true; return }
    onAdd(lines[0])
    for (const l of lines.slice(1)) {
      if (!add(l.text)) { full = true; return }
      onAdd(l)
    }
  }
  const meLines = list => list.map(i => ({ text: i.line, item: i }))
  const onMe = l => delivered.push({ id: l.item.id, revision: l.item.revision })
  const onProject = () => { included++ }

  if (meTotal) addBlock(PERSONAL_HEADER, meLines(me.core), onMe)
  if (me.core.length === 0 && meTotal && !project) add(PERSONAL_HEADER)
  if (project) {
    full = false
    let head = project.header.join('\n')
    const room = budget - (text ? text.length + 1 : 0)
    if (head.length > room) head = head.slice(0, Math.max(0, room))
    text = text ? `${text}\n${head}` : head
    const body = projectBody(project.projectDoc)
    if (body && !add(`\n${body}`)) {
      const left = budget - text.length - 2
      if (left > 1) text += `\n\n${body.slice(0, left - 1)}…`
    }
    const [decisions, confirmed, open, proposed] = secs
    for (const sec of [decisions, confirmed, open]) addBlock(`\n${sec.heading}`, sec.items.map(t => ({ text: t })), onProject)
    if (me.scoped.length && !full) addBlock(`\n[사용자 메모리] 이 과제·회사 범위`, meLines(me.scoped), onMe)
    addBlock(`\n${proposed.heading}`, proposed.items.map(t => ({ text: t })), onProject)
    if (me.other.length && !full) addBlock(`\n[사용자 메모리] 그 밖`, meLines(me.other), onMe)
  } else if (me.other.length) {
    addBlock(me.core.length ? '' : null, meLines(me.other), onMe)
  }

  const omitted = total - included
  const meOmitted = meTotal - delivered.length
  if (omitted || meOmitted) text += `\n${omissionLine(omitted, meOmitted)}`
  if (text.length > cap) text = text.slice(0, cap)
  return { text, included, omitted, meIncluded: delivered.length, meOmitted, delivered }
}

/** 과제만 주입하는 경우(사용자 메모리 없이). */
export function buildInjection({ header, projectDoc, docs, cap, tocCommand }) {
  const { text, included, omitted } = composeInjection({ cap, project: { header, projectDoc, docs }, tocCommand })
  return { text, included, omitted }
}

/** 생략 없는 전체 목차(사람·에이전트용). 상태를 함께 보인다. */
export function buildToc(projectName, projectDoc, docs) {
  const lines = [`[목차] ${projectName} — ${oneLine(projectDoc?.data?.title ?? '')}`]
  const groups = [
    ['결정', 'decision'], ['이해', 'knowledge'], ['질문', 'question'],
  ]
  for (const [label, kind] of groups) {
    const list = docs.filter(d => docKind(d.rel) === kind).sort((a, b) => a.rel.localeCompare(b.rel))
    lines.push('', `${label} (${list.length})`)
    for (const d of list) lines.push(`- ${d.rel} [${d.data.status ?? '?'}] — ${oneLine(d.data.summary)}`)
  }
  return lines.join('\n')
}
