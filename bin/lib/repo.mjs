// 사용자 저장소 식별 (설계 4.3·4.4). 브랜치 연결의 기준은 그 저장소의 git 설정 branch.<이름>.pm-project 다.
import { resolve, join } from 'node:path'
import { git } from './git.mjs'
import { readJson, writeJson } from './fsx.mjs'
import { pmRoot } from './root.mjs'

/** 원격 주소 → 호스트/경로(소문자, .git 제거). 알 수 없으면 null. */
export function parseRemote(url) {
  const s = String(url ?? '').trim()
  let m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(s)
  if (!m) m = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(s)
  if (!m || /^[a-z]$/i.test(m[1])) return null
  const path = m[2].replace(/\.git\/?$/i, '').replace(/\/+$/, '')
  if (!path.includes('/')) return null
  return `${m[1]}/${path}`.toLowerCase()
}

export function normPath(p) {
  const r = resolve(p).replace(/\\/g, '/')
  return process.platform === 'win32' ? r.toLowerCase() : r
}

const reposFile = root => join(root, 'runtime', 'repos.json')

export function registerRepo(root, commonDir, id) {
  const map = readJson(reposFile(root), {})
  map[normPath(commonDir)] = id
  writeJson(reposFile(root), map)
}

function run(cwd, args) {
  try {
    return git(cwd, args, { allowFail: true })
  } catch {
    return null
  }
}

/**
 * cwd 의 저장소 정보. git 저장소가 아니면 null.
 * { top, commonDir, branch(분리된 HEAD 면 null), id(원격 또는 등록 ID, 없으면 null), links: { 브랜치: 프로젝트 } }
 */
export function repoInfo(cwd, root = pmRoot()) {
  // 한 번의 rev-parse 로 위치와 브랜치를 함께 얻는다. 커밋이 없는 저장소에서는 HEAD 해석이 실패하므로 나눠서 다시 묻는다.
  let where = run(cwd, ['rev-parse', '--show-toplevel', '--git-common-dir', '--symbolic-full-name', 'HEAD'])
  let headRef = null
  if (where?.status === 0) {
    headRef = where.stdout.toString('utf8').split(/\r?\n/)[2] ?? null
  } else {
    where = run(cwd, ['rev-parse', '--show-toplevel', '--git-common-dir'])
    if (!where || where.status !== 0) return null
    const sym = run(cwd, ['symbolic-ref', '-q', 'HEAD'])
    headRef = sym?.status === 0 ? sym.stdout.toString('utf8').trim() : null
  }
  const [top, common] = where.stdout.toString('utf8').split(/\r?\n/)
  const commonDir = resolve(cwd, common)
  const branch = headRef?.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : null
  const conf = run(cwd, ['config', '--get-regexp', '^(remote\\.origin\\.url|branch\\..*\\.pm-project)$'])
  let remote = null
  const links = {}
  for (const line of conf?.status === 0 ? conf.stdout.toString('utf8').split(/\r?\n/) : []) {
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    const key = line.slice(0, sp)
    const value = line.slice(sp + 1)
    if (key === 'remote.origin.url') remote = value
    else if (key.startsWith('branch.') && key.endsWith('.pm-project')) links[key.slice(7, -'.pm-project'.length)] = value
  }
  const id = parseRemote(remote) ?? readJson(reposFile(root), {})[normPath(commonDir)] ?? null
  return { top, commonDir, branch, id, links }
}
