// 이 세션의 프로젝트 판정 (설계 4): 세션 선택 → 브랜치 연결 → 없음.
// last_injected 는 판정에 쓰지 않는다(턴 비교용).
import { readState } from './session.mjs'
import { repoInfo } from './repo.mjs'

export function resolveProject(root, { agent, session, cwd, repo }) {
  const state = readState(root, agent, session)
  if (state.selection?.project) return { project: state.selection.project, via: 'use' }
  const info = repo === undefined ? repoInfo(cwd, root) : repo
  const linked = info?.branch ? info.links[info.branch] : null
  return linked ? { project: linked, via: 'link' } : null
}
