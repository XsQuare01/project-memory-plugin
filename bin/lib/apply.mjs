// pm apply (설계 6.4): 잠금 전 검사 → 잠금 안에서 기준 해시 비교·근거 확인 → 트랜잭션 커밋.
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { PmError } from './errors.mjs'
import { git } from './git.mjs'
import { sha256, readIfExists, readJson, randomToken } from './fsx.mjs'
import { parseDoc, serializeDoc, validateDoc } from './frontmatter.mjs'
import { assertProjectName } from './names.mjs'
import { assertSession, sessionDir } from './session.mjs'
import { readManifest, draftPaths, docRepoRel, isDirty, dropDrafts } from './drafts.mjs'
import { withLock, commitTx } from './tx.mjs'

const CONFLICT_MARKER = /^(<{7}|>{7})( |$)|^={7}$/m

export function localToday() {
  return new Date().toLocaleDateString('sv-SE')
}

function diffText(root, agent, session, base, current) {
  const tmp = join(sessionDir(root, agent, session), 'tmp', randomToken())
  mkdirSync(tmp, { recursive: true })
  try {
    writeFileSync(join(tmp, '기준본'), base ?? Buffer.alloc(0))
    writeFileSync(join(tmp, '현재정본'), current ?? Buffer.alloc(0))
    const r = git(tmp, ['diff', '--no-index', '--no-color', '--', '기준본', '현재정본'], { allowFail: true })
    return r.stdout.toString('utf8')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** 근거가 실제로 있는지. 이번 apply 에서 새로 만들거나 지우는 문서도 반영해서 본다. */
function checkEvidence(root, project, item, items) {
  const pending = new Map(items.map(it => [it.repoRel, it.data !== null]))
  const exists = repoRel => (pending.has(repoRel) ? pending.get(repoRel) : readIfExists(join(root, repoRel)) !== null)
  for (const entry of item.doc.data.evidence ?? []) {
    const [key] = Object.keys(entry)
    const value = entry[key]
    let ok = true
    if (key === 'source') {
      const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)@([A-Za-z0-9-]+)$/.exec(value)
      const sourceJson = m && readJson(join(root, 'projects', project, 'sources', m[1], 'source.json'), null)
      ok = Boolean(sourceJson?.versions?.some(v => v.id === m[2]))
    } else if (key === 'decision' || key === 'knowledge') {
      const file = value.endsWith('.md') ? value : `${value}.md`
      ok = !file.includes('/') && exists(`projects/${project}/${key === 'decision' ? 'decisions' : 'knowledge'}/${file}`)
    }
    if (!ok) throw new PmError(`'${item.rel}' 의 근거 ${key}: ${value} 를 찾을 수 없습니다`)
  }
}

function withUserConfirmation(item, confirm, today) {
  const { data, body } = item.doc
  const line = `${today} "${confirm.replace(/"/g, "'")}"`
  const evidence = Array.isArray(data.evidence) ? data.evidence : []
  if (!evidence.some(e => e?.user === line)) data.evidence = [...evidence, { user: line }]
  return Buffer.from(serializeDoc(data, body))
}

export function apply(root, { agent, session, project, message, confirm, paths, via = 'link', today = localToday() }) {
  assertSession(agent, session)
  assertProjectName(project)
  if (!message?.trim()) throw new PmError('커밋 메시지(-m)가 필요합니다')
  const manifest = readManifest(root, agent, session)
  const prefix = `projects/${project}/`
  const keys = paths?.length ? paths.map(p => docRepoRel(project, p).repoRel) : Object.keys(manifest)
  if (!keys.length) throw new PmError('반영할 변경안이 없습니다 — 먼저 pm checkout')

  const items = keys.map(repoRel => {
    if (!repoRel.startsWith(prefix)) throw new PmError(`변경안 '${repoRel}' 은 이 세션의 프로젝트(${project}) 밖입니다 — 다른 프로젝트라면 --project 로 명시하세요`)
    const entry = manifest[repoRel]
    if (!entry) throw new PmError(`'${repoRel}' 의 변경안이 없습니다 — 먼저 pm checkout`)
    const p = draftPaths(root, agent, session, repoRel)
    const rel = repoRel.slice(prefix.length)
    const data = entry.mode === 'delete' ? null : readIfExists(p.draftPath)
    if (entry.mode !== 'delete' && data === null) throw new PmError(`'${rel}' 의 변경안 파일이 없습니다 — ${p.draftPath} 에 내용을 쓰세요`)
    const baseBuf = entry.baseHash === null ? null : readFileSync(p.basePath)
    return { repoRel, rel, entry, paths: p, data, baseBuf, doc: null }
  })

  for (const item of items) {
    if (item.data === null) continue
    if (CONFLICT_MARKER.test(item.data.toString('utf8'))) throw new PmError(`'${item.rel}' 에 충돌 표시(<<<<<<< 등)가 남아 있습니다 — 정리한 뒤 apply 하세요`)
    const parsed = parseDoc(item.data)
    if (parsed.error) throw new PmError(`'${item.rel}' — ${parsed.error}`)
    const errors = validateDoc(item.rel, parsed.data)
    if (errors.length) throw new PmError(`'${item.rel}' 머리말 오류 — ${errors.join('; ')}`)
    item.doc = parsed
  }

  for (const item of items) {
    const before = item.baseBuf ? parseDoc(item.baseBuf).data?.status : null
    const after = item.doc?.data?.status ?? null
    if (before !== 'confirmed' && after !== 'confirmed') continue
    if (!confirm?.trim()) {
      throw new PmError(`'${item.rel}' 은 confirmed 문서의 작성·승격·수정·삭제입니다 — 사용자 확인을 --confirm "<확인 내용 요약>" 으로 주세요. 새 해석은 별도 proposed 항목으로 쓰세요`)
    }
    if (item.data !== null) item.data = withUserConfirmation(item, confirm.trim(), today)
  }

  const changed = items.filter(it => !(it.data !== null && it.baseBuf !== null && it.data.equals(it.baseBuf)))
  const unchanged = items.filter(it => !changed.includes(it))
  if (!changed.length) {
    dropDrafts(root, agent, session, unchanged.map(it => it.repoRel))
    return { txId: null, commit: null, files: [] }
  }

  return withLock(root, { agent, session }, () => {
    const conflicts = []
    for (const item of changed) {
      if (isDirty(root, item.repoRel)) {
        conflicts.push(`- ${item.rel}: 커밋 안 된 변경이 있습니다(사용자 편집일 수 있음)`)
        continue
      }
      const current = readIfExists(join(root, item.repoRel))
      if ((current === null ? null : sha256(current)) !== item.entry.baseHash) {
        conflicts.push(`- ${item.rel}: 정본이 변경안의 기준과 다릅니다\n${diffText(root, agent, session, item.baseBuf, current)}`)
      }
    }
    if (conflicts.length) {
      const err = new PmError(`충돌 — 아무것도 쓰지 않았습니다. pm checkout --refresh <경로> 로 기준을 새로 받으세요\n${conflicts.join('\n')}`, 3)
      throw err
    }
    for (const item of changed) if (item.doc) checkEvidence(root, project, item, changed)

    const result = commitTx(root, {
      files: changed.map(it => ({ path: it.repoRel, data: it.data })),
      message,
      trailers: { Project: project, Agent: agent, Session: session, Via: via },
      meta: { agent, session },
    })
    dropDrafts(root, agent, session, items.map(it => it.repoRel))
    return { ...result, files: changed.map(it => it.rel) }
  })
}
