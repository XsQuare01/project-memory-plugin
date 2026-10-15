import { PmError } from './errors.mjs'
import { assertProjectName } from './names.mjs'
import { resolveProject } from './resolve.mjs'
import { readState } from './session.mjs'
import { pinHead, readProject } from './snapshot.mjs'

/** 명령이 다룰 프로젝트. --project 가 있으면 그것(via: explicit), 없으면 세션 판정. */
export function projectForCommand(root, values, { agent, session }) {
  if (values.project) {
    assertProjectName(values.project)
    return { project: values.project, via: 'explicit' }
  }
  // 에이전트가 실행한 명령의 작업 폴더는 cd 로 바뀔 수 있다. 훅이 기록한 세션 폴더가 있으면 그것으로 판정한다.
  const cwd = readState(root, agent, session).cwd ?? process.cwd()
  const resolved = resolveProject(root, { agent, session, cwd })
  if (!resolved) throw new PmError('이 세션의 프로젝트가 정해지지 않았습니다 — pm use <이름> 또는 pm link <이름>, 아니면 --project', 2)
  return resolved
}

/** 커밋된 내용 기준으로 프로젝트가 있는지 확인한다. */
export function assertProjectExists(root, project) {
  assertProjectName(project)
  if (!readProject(root, pinHead(root), project).exists) {
    throw new PmError(`프로젝트 '${project}' 가 없습니다 — 새로 만들려면 pm new ${project}`)
  }
}
