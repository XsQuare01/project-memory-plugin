// 원본 자료 (설계 3.3). 받은 묶음을 버전 폴더에 그대로 복사하고, 버전 폴더는 만든 뒤 바꾸지 않는다.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, basename, extname, relative } from 'node:path'
import { PmError } from './errors.mjs'
import { sha256, readJson } from './fsx.mjs'
import { isValidProjectName, assertProjectName } from './names.mjs'
import { withLock, commitTx } from './tx.mjs'
import { localToday } from './apply.mjs'

/** 묶음 안 파일 목록(상대 경로는 '/' 구분, 정렬). 파일 하나면 [이름]. */
function listFiles(from) {
  const st = statSync(from)
  if (st.isFile()) return [{ rel: basename(from), abs: from }]
  const out = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else out.push({ rel: relative(from, abs).replace(/\\/g, '/'), abs })
    }
  }
  walk(from)
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/** 상대경로 \t 크기 \t 파일 sha256 줄을 상대경로 순으로 이어 붙인 텍스트의 sha256. */
export function bundleHash(from) {
  const lines = listFiles(from).map(f => {
    const buf = readFileSync(f.abs)
    return `${f.rel}\t${buf.length}\t${sha256(buf)}`
  })
  return sha256(Buffer.from(lines.join('\n')))
}

export function addSource(root, { agent, session, project, from, as, date, note }) {
  assertProjectName(project)
  if (!isValidProjectName(as)) throw new PmError(`자료 이름 '${as}' 은 영문 소문자·숫자·하이픈이어야 합니다`)
  if (!existsSync(from)) throw new PmError(`원본 '${from}' 이 없습니다`)
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PmError('--date 는 YYYY-MM-DD 입니다')
  const isFile = statSync(from).isFile()
  const files = listFiles(from)
  if (!files.length) throw new PmError(`원본 '${from}' 에 파일이 없습니다`)
  const hash = bundleHash(from)
  const today = localToday()
  const id = `${date ?? today}-${hash.slice(0, 8)}`
  const dir = `projects/${project}/sources/${as}`

  return withLock(root, { agent, session }, () => {
    if (!existsSync(join(root, 'projects', project, 'project.md'))) throw new PmError(`프로젝트 '${project}' 가 없습니다`)
    const sj = readJson(join(root, dir, 'source.json'), { title: as, versions: [] })
    const same = sj.versions.find(v => v.bundle_sha256 === hash)
    if (same) throw new PmError(`같은 묶음이 이미 있습니다 — ${as}@${same.id}`)
    if (existsSync(join(root, dir, id))) throw new PmError(`버전 폴더 ${dir}/${id} 가 이미 있습니다`)
    sj.versions.push({ id, original_name: basename(from), received: today, bundle_sha256: hash, ...(note ? { note } : {}) })
    const writes = files.map(f => ({
      path: `${dir}/${id}/${isFile ? `${as}${extname(from)}` : f.rel}`,
      data: readFileSync(f.abs),
    }))
    writes.push({ path: `${dir}/source.json`, data: Buffer.from(`${JSON.stringify(sj, null, 2)}\n`) })
    const r = commitTx(root, {
      files: writes,
      message: `자료 추가: ${as}@${id}`,
      trailers: { Project: project, Agent: agent, Session: session, Via: 'add-source' },
      meta: {},
    })
    return { ...r, id, ref: `${as}@${id}`, files: writes.length - 1 }
  })
}
