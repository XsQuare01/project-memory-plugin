import { PmError } from './errors.mjs'

const PROJECT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidProjectName(name) {
  return typeof name === 'string' && name.length <= 40 && PROJECT_NAME.test(name)
}

export function assertProjectName(name) {
  if (!isValidProjectName(name)) {
    throw new PmError(`프로젝트 이름 '${name}' 은 규칙에 맞지 않습니다 — 영문 소문자·숫자·하이픈, 40자 이내`)
  }
}

/** 사용자가 준 상대 경로를 '/' 구분으로 바꾸고, 절대 경로나 밖으로 나가는 경로를 거부한다. */
export function normalizeRel(rel) {
  const s = String(rel ?? '').replace(/\\/g, '/')
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s)) throw new PmError(`경로 '${rel}' 은 상대 경로여야 합니다`)
  const parts = s.split('/').filter(p => p !== '' && p !== '.')
  if (parts.length === 0 || parts.includes('..')) throw new PmError(`경로 '${rel}' 은 쓸 수 없습니다`)
  return parts.join('/')
}

/** 저장소 상대 경로 → { project, area, rest }. 프로젝트 밖이면 project 는 null. */
export function classifyPath(repoRel) {
  const m = /^projects\/([^/]+)\/(.+)$/.exec(repoRel)
  if (!m) return { project: null, area: null, rest: repoRel }
  const [, project, rest] = m
  if (rest === 'project.md') return { project, area: 'project', rest }
  const area = rest.split('/')[0]
  return { project, area: ['knowledge', 'decisions', 'questions', 'sources'].includes(area) ? area : 'other', rest: rest.slice(area.length + 1) }
}
