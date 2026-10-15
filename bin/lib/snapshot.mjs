// 고정 커밋에서 읽기 (설계 5.1 "읽기 기준 커밋"). 주입·목차·뷰어는 작업 폴더가 아니라 커밋된 내용만 본다.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { git, gitText } from './git.mjs'
import { parseDoc, docKind } from './frontmatter.mjs'

export function pinHead(root) {
  // 아직 준비되지 않은 데이터 위치(폴더 없음·git 아님)는 "커밋 없음"으로 본다.
  if (!existsSync(join(root, '.git'))) return null
  const r = git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true })
  return r.status === 0 ? r.stdout.toString('utf8').trim() : null
}

export function listTree(root, commit, prefix) {
  if (!commit) return []
  return gitText(root, ['ls-tree', '-r', '-z', '--name-only', commit, '--', prefix]).split('\0').filter(Boolean)
}

/** 여러 파일을 git cat-file --batch 한 번으로 읽는다. 없는 파일은 결과에 없다. */
export function readBlobs(root, commit, paths) {
  const result = new Map()
  if (!commit || !paths.length) return result
  const input = paths.map(p => `${commit}:${p}\n`).join('')
  const outBuf = git(root, ['cat-file', '--batch'], { input }).stdout
  let pos = 0
  for (const path of paths) {
    const nl = outBuf.indexOf(0x0a, pos)
    const header = outBuf.subarray(pos, nl).toString('utf8')
    pos = nl + 1
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) continue
    const size = Number(header.split(' ')[2])
    result.set(path, outBuf.subarray(pos, pos + size))
    pos += size + 1
  }
  return result
}

/** 그 커밋에서 본 프로젝트 폴더의 마지막 커밋. */
export function revisionOf(root, commit, project) {
  if (!commit) return null
  return gitText(root, ['log', '-1', '--format=%H', commit, '--', `projects/${project}`]).trim() || null
}

/** 그 커밋의 프로젝트 문서 전부. { exists, projectDoc, docs: [{ rel, kind, data, body }], files } */
export function readProject(root, commit, project) {
  const prefix = `projects/${project}/`
  const files = listTree(root, commit, prefix).map(p => p.slice(prefix.length))
  if (!files.length) return { exists: false, projectDoc: null, docs: [], files: [] }
  const wanted = files.filter(rel => docKind(rel))
  const blobs = readBlobs(root, commit, wanted.map(rel => prefix + rel))
  let projectDoc = null
  const docs = []
  for (const rel of wanted) {
    const parsed = parseDoc(blobs.get(prefix + rel))
    const kind = docKind(rel)
    if (kind === 'project') projectDoc = parsed
    else docs.push({ rel, kind, data: parsed.data ?? {}, body: parsed.body, error: parsed.error })
  }
  return { exists: true, projectDoc, docs, files }
}

export function listProjects(root, commit) {
  const names = new Set()
  for (const p of listTree(root, commit, 'projects/')) names.add(p.split('/')[1])
  return [...names].sort()
}
