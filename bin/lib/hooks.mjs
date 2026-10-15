// 훅 명령 context(세션 시작) / turn(턴 시작) (설계 5.1·5.2, 사용자 메모리 ②).
// 과제 내용은 시작할 때 고정한 커밋 하나에서만 읽고, 쓰기 잠금은 기다리지 않는다.
// 사용자 메모리는 범위(과제·회사)에 맞는 항목만 넣고, 세션 상태에 실제 전달한 항목(ID·판번호)을 남긴다.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, gitText } from './git.mjs'
import { pinHead, readProject, revisionOf, readBlobs } from './snapshot.mjs'
import { composeInjection, personalBlocks, oneLine, PERSONAL_HEADER } from './inject.mjs'
import { parseDoc, docKind } from './frontmatter.mjs'
import { repoInfo } from './repo.mjs'
import { resolveProject } from './resolve.mjs'
import { readState, updateState, recentSelectionInCwd } from './session.mjs'
import { meRoot, readItems, readTombstones } from './me-store.mjs'
import { localToday } from './apply.mjs'

export const CAPS = { claude: 6000, codex: 3000 }
export const PM_PATH = fileURLToPath(new URL('../pm.mjs', import.meta.url)).replace(/\\/g, '/')

const POLICY_PATH = fileURLToPath(new URL('../../policy.md', import.meta.url)).replace(/\\/g, '/')
const SKILL = '/project-memory:project'

const pmCmd = (agent, session) => `node ${PM_PATH} <명령> --agent ${agent} --session ${session}`
const meListCmd = `node ${PM_PATH} me list`

function headerFor(root, { agent, session, project, via, repo, title }) {
  const how = via === 'use' ? '세션 선택(pm use)' : `브랜치 연결 ${repo?.id ?? repo?.top}@${repo?.branch}`
  return [
    `[프로젝트 메모리] ${project} — ${oneLine(title)}`,
    `세션: ${agent}/${session} · 판정: ${how}`,
    `경로: ${join(root, 'projects', project)}`,
    `명령: ${pmCmd(agent, session)}`,
    `규칙: 이 과제의 이해·결정·질문은 내장 메모리가 아니라 여기에 기록한다(자세히: ${POLICY_PATH}, 명령: ${SKILL}).`,
    '      정본은 직접 고치지 않는다. pm checkout → 변경안 수정 → pm apply -m "<메시지>".',
    '      새 해석은 별도 proposed 항목으로. confirmed 문서는 사용자 확인(--confirm) 없이 고치지 않는다.',
    '      작업 상태·개인 취향·임시 경로·절대 경로·비밀은 쓰지 않는다. 기록하면 응답에 한 줄로 알린다.',
  ]
}

function meItems() {
  try {
    return readItems(meRoot())
  } catch (err) {
    process.stderr.write(`pm: 사용자 메모리를 읽지 못했습니다 — ${err.message}\n`)
    return []
  }
}

/** 지금 세션에 적용되는 사용자 항목(단계별)과 { id: 판번호 } 지도. */
function personalFor(items, project, company) {
  const blocks = personalBlocks(items, { project, company, today: localToday() })
  const all = [...blocks.core, ...blocks.scoped, ...blocks.other]
  return { blocks, all, seen: Object.fromEntries(all.map(i => [i.id, i.revision])) }
}

/** 고정 커밋 pin 에서 과제(+사용자) 주입 글. 과제가 그 커밋에 없으면 null. */
function injectionFor(root, pin, { agent, session, project, via, repo, cap, items }) {
  const snap = readProject(root, pin, project)
  if (!snap.exists) return null
  const company = snap.projectDoc?.data?.company ?? null
  const personal = personalFor(items, project, company)
  const header = headerFor(root, { agent, session, project, via, repo, title: snap.projectDoc?.data?.title ?? '' })
  const r = composeInjection({
    cap,
    project: { header, projectDoc: snap.projectDoc, docs: snap.docs },
    personal: personal.blocks,
    tocCommand: `node ${PM_PATH} toc ${project}`,
    meListCommand: meListCmd,
  })
  return { text: r.text, delivered: r.delivered, seen: personal.seen, company }
}

/** 과제 없이 사용자 항목만. 적용할 항목이 없으면 text 는 null. */
function personalOnly(items, cap) {
  const personal = personalFor(items, null, null)
  if (!personal.all.length) return { text: null, delivered: [], seen: {} }
  const r = composeInjection({ cap, personal: personal.blocks, meListCommand: meListCmd })
  return { text: r.text, delivered: r.delivered, seen: personal.seen }
}

const deliveredMap = list => Object.fromEntries(list.map(d => [d.id, d.revision]))

function remember(root, { agent, session, cwd }, patch) {
  updateState(root, agent, session, { cwd: cwd ?? null, ...patch })
}

/** 상태 파일을 바꾸지 않는 미리보기(pm status 용). */
export function previewFor(root, { agent, session, cwd, cap = CAPS[agent] ?? 6000 }) {
  const repo = cwd ? repoInfo(cwd, root) : null
  const resolved = resolveProject(root, { agent, session, cwd, repo })
  const items = meItems()
  const r = resolved ? injectionFor(root, pinHead(root), { agent, session, ...resolved, repo, cap, items }) : personalOnly(items, cap)
  return { resolved, repo, text: r?.text ?? null }
}

/** 세션 시작 주입. 넣을 것이 없으면 null. */
export function contextFor(root, { agent, session, cwd, cap = CAPS[agent] ?? 6000 }) {
  const pin = pinHead(root)
  const repo = cwd ? repoInfo(cwd, root) : null
  const resolved = resolveProject(root, { agent, session, cwd, repo })
  const items = meItems()
  if (resolved) {
    const r = injectionFor(root, pin, { agent, session, ...resolved, repo, cap, items })
    if (r) {
      remember(root, { agent, session, cwd }, {
        last_injected: { ...resolved, revision: revisionOf(root, pin, resolved.project), at: new Date().toISOString() },
        me_seen: r.seen,
        me_delivered: deliveredMap(r.delivered),
      })
      return r.text
    }
  }
  const recent = cwd ? recentSelectionInCwd(root, { agent, cwd, exclude: session }) : null
  const hint = recent
    ? `[프로젝트 메모리] 이 폴더에서 최근 선택한 프로젝트: ${recent} — 이어 쓰려면 ${SKILL} use ${recent} (또는 node ${PM_PATH} use ${recent} --agent ${agent} --session ${session})`
    : repo && Object.keys(repo.links).length
      ? `[프로젝트 메모리] 이 브랜치는 연결 안 됨 — pm link <이름> 또는 pm use <이름> (명령: ${pmCmd(agent, session)})`
      : null
  const p = personalOnly(items, cap - (hint ? hint.length + 1 : 0))
  remember(root, { agent, session, cwd }, { last_injected: null, me_seen: p.seen, me_delivered: deliveredMap(p.delivered) })
  return [p.text, hint].filter(Boolean).join('\n') || null
}

/** from..pin 사이 그 프로젝트를 바꾼 커밋 중, 이 세션(같은 Agent·Session 꼬리표)이 아닌 것. 범위를 못 읽으면 null. */
function othersCommits(root, pin, project, from, { agent, session }) {
  const r = git(root, ['log', '--format=%H%x00%(trailers:key=Agent,valueonly,separator=)%x00%(trailers:key=Session,valueonly,separator=)', `${from}..${pin}`, '--', `projects/${project}`], { allowFail: true })
  if (r.status !== 0) return null
  return r.stdout.toString('utf8').split('\n').filter(Boolean)
    .map(line => line.split('\0'))
    .filter(([, a, s]) => !(a?.trim() === agent && s?.trim() === session))
    .map(([hash]) => hash)
    .reverse()
}

/** 다른 세션·사용자가 바꾼 문서. 반환: [{ status, path, rel }] (같은 파일은 마지막 상태). */
function changedByOthers(root, project, commits) {
  const byPath = new Map()
  for (const commit of commits) {
    const parts = gitText(root, ['diff-tree', '-r', '-z', '--no-commit-id', '--name-status', '--root', commit, '--', `projects/${project}`]).split('\0').filter(Boolean)
    for (let i = 0; i < parts.length; i++) {
      const status = parts[i]
      const renamed = status.startsWith('R') || status.startsWith('C')
      const path = parts[i + (renamed ? 2 : 1)]
      i += renamed ? 2 : 1
      const rel = path.slice(`projects/${project}/`.length)
      if (docKind(rel)) byPath.set(path, { status: status[0], path, rel })
    }
  }
  return [...byPath.values()]
}

function changedSince(root, pin, project, from, cap, who) {
  if (!from) return null
  const commits = othersCommits(root, pin, project, from, who)
  if (commits === null) return null
  const changes = changedByOthers(root, project, commits)
  if (!changes.length) return ''
  const blobs = readBlobs(root, pin, changes.filter(c => c.status !== 'D').map(c => c.path))
  const label = { A: '추가', M: '수정', D: '삭제', R: '이름 바뀜' }
  const lines = [`[프로젝트 메모리] ${project} 가 바뀌었습니다(다른 세션 또는 사용자) — 바뀐 항목:`]
  let omitted = 0
  for (const c of changes) {
    const data = blobs.has(c.path) ? parseDoc(blobs.get(c.path)).data : null
    const line = `- ${label[c.status] ?? c.status} ${c.rel}${data ? `${data.status ? ` [${data.status}]` : ''} — ${oneLine(data.summary)}` : ''}`
    if (lines.join('\n').length + line.length + 80 > cap) omitted++
    else lines.push(line)
  }
  if (omitted) lines.push(`(생략 ${omitted}개 — node ${PM_PATH} toc ${project})`)
  return lines.join('\n')
}

/**
 * 사용자 메모리 변화(설계 ②): 지금 적용 대상을 다시 계산해 지난번에 본 것과 비교한다.
 * 범위 밖 변경은 대상에 없으므로 알리지 않고, 자기 세션의 변경도 알리지 않는다.
 */
function personalChanges(personal, lastSeen, self, root, cap) {
  const tombBy = new Map(readTombstones(meRoot()).map(t => [t.id, t.by]))
  const added = personal.all.filter(i => lastSeen[i.id] !== i.revision && i.updatedBy !== self)
  const removed = Object.keys(lastSeen).filter(id => !(id in personal.seen) && tombBy.get(id) !== self)
  // 자기 세션이 범위를 바꿔 빠진 항목은 알리지 않는다.
  const stillThere = new Map(meItemsSafe(root).map(i => [i.id, i.data.updated_by]))
  const removedByOthers = removed.filter(id => stillThere.get(id) !== self)
  if (!added.length && !removedByOthers.length) return null
  const lines = ['[사용자 메모리] 바뀐 항목(다른 세션 또는 사용자):']
  let omitted = 0
  for (const line of [...added.map(i => i.line), ...removedByOthers.map(id => `- 이제 적용하지 않음: ${id}`)]) {
    if (lines.join('\n').length + line.length + 60 > cap) omitted++
    else lines.push(line)
  }
  if (omitted) lines.push(`(생략 ${omitted}개 — ${meListCmd})`)
  return { text: lines.join('\n'), delivered: added }
}

const meItemsSafe = () => meItems()

/** 턴 시작 확인. 바뀐 것이 없으면 null. */
export function turnFor(root, { agent, session, cwd, cap = CAPS[agent] ?? 6000 }) {
  const state = readState(root, agent, session)
  const last = state.last_injected
  const lastSeen = state.me_seen ?? {}
  const self = `${agent}/${session}`
  const repo = cwd ? repoInfo(cwd, root) : null
  const resolved = resolveProject(root, { agent, session, cwd, repo })
  const items = meItems()

  // 과제 쪽: 바뀐 것이 없으면 null, 과제가 없어졌으면 알림, 처음이거나 바뀌었으면 전체 주입.
  let projectText = null
  let lastInjected = last
  let full = null
  let project = null
  let company = null
  if (resolved || last) {
    const pin = pinHead(root)
    const snap = resolved ? readProject(root, pin, resolved.project) : null
    if (!snap?.exists) {
      if (last) projectText = `[프로젝트 메모리] 이 대화에 더 이상 프로젝트가 정해져 있지 않습니다 (이전: ${last.project}). 이전 내용은 대화에 남아 있습니다`
      lastInjected = null
    } else {
      project = resolved.project
      company = snap.projectDoc?.data?.company ?? null
      const revision = revisionOf(root, pin, project)
      lastInjected = { ...resolved, revision, at: new Date().toISOString() }
      if (last?.project === project) {
        if (last.revision !== revision) {
          const changed = changedSince(root, pin, project, last.revision, cap, { agent, session })
          if (changed) projectText = changed
          else if (changed === null) full = { warning: null }
        }
      } else {
        full = { warning: last ? `[주의] 이 대화에는 이전 프로젝트(${last.project})의 내용이 남아 있습니다. 엄격히 나누려면 /clear 또는 새 대화를 쓰세요.` : null }
      }
      if (full) {
        const r = injectionFor(root, pin, { agent, session, ...resolved, repo, cap: cap - (full.warning ? full.warning.length + 1 : 0), items })
        const personal = personalFor(items, project, company)
        const gone = Object.keys(lastSeen).filter(id => !(id in personal.seen))
        const goneText = gone.length ? `[사용자 메모리] 이제 적용하지 않음: ${gone.join(', ')}` : null
        remember(root, { agent, session, cwd }, { last_injected: lastInjected, me_seen: r.seen, me_delivered: deliveredMap(r.delivered) })
        return [full.warning, r.text, goneText].filter(Boolean).join('\n')
      }
    }
  }

  // 사용자 메모리 쪽: 지금 대상과 지난번 대상을 비교한다.
  const personal = personalFor(items, project, company)
  const room = cap - (projectText ? projectText.length + 1 : 0)
  const changes = personalChanges(personal, lastSeen, self, root, room)
  const delivered = { ...(state.me_delivered ?? {}) }
  for (const id of Object.keys(delivered)) if (!(id in personal.seen)) delete delivered[id]
  for (const i of changes?.delivered ?? []) delivered[i.id] = i.revision
  for (const i of personal.all) if (i.updatedBy === self && i.id in delivered) delivered[i.id] = i.revision
  const unchangedProject = lastInjected === last || (last && lastInjected && last.project === lastInjected.project && last.revision === lastInjected.revision)
  const unchangedMe = JSON.stringify(lastSeen) === JSON.stringify(personal.seen)
  if (!(unchangedProject && unchangedMe)) {
    remember(root, { agent, session, cwd }, { last_injected: lastInjected, me_seen: personal.seen, me_delivered: delivered })
  }
  return [projectText, changes?.text].filter(Boolean).join('\n') || null
}

export { PERSONAL_HEADER }
