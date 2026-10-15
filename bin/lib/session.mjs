import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { PmError } from './errors.mjs'
import { readJson, writeJson } from './fsx.mjs'
import { normPath } from './repo.mjs'

const AGENT = /^[a-z0-9][a-z0-9-]{0,31}$/
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** 도구 이름과 세션 ID 는 폴더 이름으로 쓰이므로 안전한 글자만 받는다. */
export function assertSession(agent, session) {
  if (!AGENT.test(agent ?? '')) throw new PmError(`--agent '${agent ?? ''}' 가 올바르지 않습니다 (예: claude, codex)`)
  if (!SESSION.test(session ?? '')) throw new PmError(`--session '${session ?? ''}' 가 올바르지 않습니다`)
}

export function sessionsRoot(root) {
  return join(root, 'runtime', 'sessions')
}

export function sessionDir(root, agent, session) {
  assertSession(agent, session)
  return join(sessionsRoot(root), agent, session)
}

// 세션 상태 (설계 4.1). selection 은 pm use 만, last_injected 는 context·turn 만 바꾼다.
const EMPTY = { selection: null, last_injected: null, cwd: null, updated: null }

export function readState(root, agent, session) {
  return { ...EMPTY, ...readJson(join(sessionDir(root, agent, session), 'state.json'), {}) }
}

export function updateState(root, agent, session, patch) {
  const next = { ...readState(root, agent, session), ...patch, updated: new Date().toISOString() }
  writeJson(join(sessionDir(root, agent, session), 'state.json'), next)
  return next
}

/** 같은 도구·같은 폴더에서 최근(기본 2시간) 선택된 프로젝트. 직전 세션이라고 단정하지 않는 안내용. */
export function recentSelectionInCwd(root, { agent, cwd, exclude, now = Date.now(), windowMs = 2 * 60 * 60 * 1000 }) {
  const dir = join(sessionsRoot(root), agent)
  if (!cwd || !existsSync(dir)) return null
  const want = normPath(cwd)
  let best = null
  for (const session of readdirSync(dir)) {
    if (session === exclude) continue
    const state = readJson(join(dir, session, 'state.json'), null)
    const at = Date.parse(state?.selection?.at ?? '')
    if (!state?.selection?.project || !state.cwd || normPath(state.cwd) !== want) continue
    if (!(now - at <= windowMs) || at > now) continue
    if (!best || at > best.at) best = { project: state.selection.project, at }
  }
  return best?.project ?? null
}
