// 변경안 (설계 6.2·6.3). 정본을 한 번 읽은 바이트로 기준본·변경안을 만들고, 같은 바이트로 기준 해시를 계산한다.
// 세션 폴더: runtime/sessions/<도구>/<세션>/{drafts.json, base/, draft/, base.prev/, draft.prev/}
import { join, dirname } from 'node:path'
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { PmError } from './errors.mjs'
import { git, gitText } from './git.mjs'
import { sha256, atomicWrite, readIfExists, readJson, writeJson, randomToken } from './fsx.mjs'
import { docKind } from './frontmatter.mjs'
import { normalizeRel, assertProjectName } from './names.mjs'
import { sessionDir } from './session.mjs'

const manifestPath = (root, agent, session) => join(sessionDir(root, agent, session), 'drafts.json')

export function readManifest(root, agent, session) {
  return readJson(manifestPath(root, agent, session), {})
}

function writeManifest(root, agent, session, manifest) {
  writeJson(manifestPath(root, agent, session), manifest)
}

export function draftPaths(root, agent, session, repoRel) {
  const dir = sessionDir(root, agent, session)
  return {
    draftPath: join(dir, 'draft', repoRel),
    basePath: join(dir, 'base', repoRel),
    prevDraftPath: join(dir, 'draft.prev', repoRel),
    prevBasePath: join(dir, 'base.prev', repoRel),
  }
}

/** 프로젝트 기준 상대 경로를 검사해 저장소 상대 경로로 바꾼다. 문서 경로만 받는다. */
export function docRepoRel(project, rel) {
  assertProjectName(project)
  const r = normalizeRel(rel)
  if (r.split('/')[0] === 'sources') throw new PmError(`'${r}' — sources/ 아래는 pm add-source 로만 바꿉니다`)
  if (!docKind(r)) throw new PmError(`'${r}' 은 프로젝트 문서 경로가 아닙니다 (project.md, knowledge/·decisions/·questions/ 아래 .md)`)
  return { rel: r, repoRel: `projects/${project}/${r}` }
}

/** 추적 안 된 파일을 포함해, 그 경로에 커밋 안 된 변경이 있는지. */
export function isDirty(root, repoRel) {
  return gitText(root, ['status', '--porcelain', '-z', '--untracked-files=all', '--', repoRel]) !== ''
}

export function checkout(root, { agent, session, project, paths, mode = 'edit' }) {
  if (!['edit', 'new', 'delete'].includes(mode)) throw new PmError(`모르는 checkout 방식 '${mode}'`)
  const manifest = readManifest(root, agent, session)
  const out = []
  for (const input of paths) {
    const { rel, repoRel } = docRepoRel(project, input)
    if (manifest[repoRel]) throw new PmError(`'${rel}' 의 변경안이 이미 있습니다 — 기준을 새로 받으려면 checkout --refresh`)
    if (isDirty(root, repoRel)) throw new PmError(`'${rel}' 에 커밋 안 된 변경이 있습니다 — 사용자의 편집일 수 있어 건드리지 않습니다`)
    const canonical = readIfExists(join(root, repoRel))
    const p = draftPaths(root, agent, session, repoRel)
    for (const path of Object.values(p)) rmSync(path, { force: true })
    let baseHash = null
    if (mode === 'new') {
      if (canonical !== null) throw new PmError(`'${rel}' 이 이미 있습니다 — 고치려면 --new 없이 checkout`)
      mkdirSync(dirname(p.draftPath), { recursive: true })
    } else {
      if (canonical === null) throw new PmError(`'${rel}' 이 없습니다 — 새로 만들려면 --new`)
      atomicWrite(p.basePath, canonical)
      if (mode === 'edit') atomicWrite(p.draftPath, canonical)
      baseHash = sha256(canonical)
    }
    manifest[repoRel] = { mode, baseHash, checkedOut: new Date().toISOString() }
    out.push({ rel, repoRel, mode, ...p })
  }
  writeManifest(root, agent, session, manifest)
  return out
}

function mergeFile(root, agent, session, mine, base, current) {
  const tmp = join(sessionDir(root, agent, session), 'tmp', randomToken())
  mkdirSync(tmp, { recursive: true })
  try {
    const files = { mine: join(tmp, 'mine'), base: join(tmp, 'base'), cur: join(tmp, 'cur') }
    writeFileSync(files.mine, mine)
    writeFileSync(files.base, base)
    writeFileSync(files.cur, current)
    const r = git(root, ['merge-file', '-p', '-L', '내변경안', '-L', '기준본', '-L', '현재정본', files.mine, files.base, files.cur], { allowFail: true })
    if (r.status < 0 || r.status > 127) throw new PmError(`git merge-file 실패 — ${r.stderr.trim()}`)
    return { out: r.stdout, conflicts: r.status }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** 충돌 뒤 기준을 새로 받는다. 기존 기준본·변경안은 .prev 로 보존하고 3방향 병합으로 새 변경안을 만든다. */
export function refresh(root, { agent, session, project, paths }) {
  const manifest = readManifest(root, agent, session)
  const out = []
  for (const input of paths) {
    const { rel, repoRel } = docRepoRel(project, input)
    const entry = manifest[repoRel]
    if (!entry) throw new PmError(`'${rel}' 의 변경안이 없습니다 — 먼저 pm checkout`)
    if (isDirty(root, repoRel)) throw new PmError(`'${rel}' 에 커밋 안 된 변경이 있습니다 — 사용자의 편집일 수 있어 건드리지 않습니다`)
    const p = draftPaths(root, agent, session, repoRel)
    const current = readIfExists(join(root, repoRel))
    const oldBase = entry.baseHash === null ? null : readFileSync(p.basePath)
    const mine = entry.mode === 'delete' ? null : readIfExists(p.draftPath)

    rmSync(p.prevBasePath, { force: true })
    rmSync(p.prevDraftPath, { force: true })
    if (oldBase !== null) atomicWrite(p.prevBasePath, oldBase)
    if (mine !== null) atomicWrite(p.prevDraftPath, mine)

    let conflicted = false
    let note = null
    if (current === null) {
      rmSync(p.basePath, { force: true })
      entry.baseHash = null
      if (entry.mode === 'delete') {
        delete manifest[repoRel]
        note = '정본이 이미 지워졌습니다 — 삭제할 것이 없어 변경안을 정리했습니다'
      } else {
        entry.mode = 'new'
        note = '정본이 지워졌습니다 — 이 변경안을 반영하면 다시 만들어집니다'
      }
    } else {
      atomicWrite(p.basePath, current)
      entry.baseHash = sha256(current)
      if (entry.mode === 'new') entry.mode = 'edit'
      if (mine !== null) {
        const merged = mergeFile(root, agent, session, mine, oldBase ?? Buffer.alloc(0), current)
        atomicWrite(p.draftPath, merged.out)
        conflicted = merged.conflicts > 0
      }
    }
    out.push({ rel, repoRel, conflicted, note, ...p })
  }
  writeManifest(root, agent, session, manifest)
  return out
}

/** 반영했거나 버린 변경안을 지운다(.prev 포함). */
export function dropDrafts(root, agent, session, repoRels) {
  const manifest = readManifest(root, agent, session)
  for (const repoRel of repoRels) {
    for (const path of Object.values(draftPaths(root, agent, session, repoRel))) rmSync(path, { force: true })
    delete manifest[repoRel]
  }
  writeManifest(root, agent, session, manifest)
}
