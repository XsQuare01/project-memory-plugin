// pm link / unlink (설계 4.3). 사용자 저장소의 그 브랜치 설정 키 하나와 links.json 을 한 트랜잭션으로 바꾼다.
// 외부 설정도 작업 기록에 들어가므로, 어느 단계에서 실패해도 그 키만 이전 값으로 돌아간다.
import { join } from 'node:path'
import { PmError } from './errors.mjs'
import { readJson } from './fsx.mjs'
import { repoInfo } from './repo.mjs'
import { isDirty } from './drafts.mjs'
import { withLock, commitTx } from './tx.mjs'

function currentRepo(root, cwd) {
  const repo = repoInfo(cwd, root)
  if (!repo) throw new PmError('지금 폴더는 git 저장소가 아닙니다 — git 밖에서는 pm use 를 쓰세요')
  if (!repo.branch) throw new PmError('분리된 HEAD 에서는 브랜치 연결을 만들 수 없습니다 — 브랜치로 전환하거나 pm use 를 쓰세요')
  return repo
}

function change(root, { agent, session, cwd, project }) {
  const repo = currentRepo(root, cwd)
  const key = `branch.${repo.branch}.pm-project`
  return withLock(root, { agent, session }, () => {
    if (isDirty(root, 'links.json')) throw new PmError('links.json 에 커밋 안 된 변경이 있습니다 — 사용자의 편집일 수 있어 건드리지 않습니다')
    const links = readJson(join(root, 'links.json'), {})
    const name = repo.id ? `${repo.id}@${repo.branch}` : null
    const files = []
    if (name) {
      if (project) links[name] = { project, linked_at: new Date().toISOString() }
      else delete links[name]
      files.push({ path: 'links.json', data: Buffer.from(`${JSON.stringify(links, null, 2)}\n`) })
    }
    const label = name ?? `${repo.top}@${repo.branch}`
    const r = commitTx(root, {
      files,
      gitConfig: [{ commonDir: repo.commonDir, key, value: project ?? null }],
      message: project ? `link: ${label} → ${project}` : `unlink: ${label}`,
      trailers: { Project: project ?? repo.links[repo.branch] ?? '-', Agent: agent, Session: session, Via: 'link' },
      meta: {},
    })
    return { ...r, repo, label }
  })
}

export function link(root, opts) {
  return change(root, opts)
}

export function unlink(root, opts) {
  return change(root, { ...opts, project: null })
}
