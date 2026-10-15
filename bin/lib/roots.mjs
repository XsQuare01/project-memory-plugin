// 저장 위치: 과제 데이터(project) · 사용자 메모리(personal). 사용자가 플러그인 옵션으로 정한다.
// 우선순위: 테스트 변수(PM_ROOT·PM_ME_ROOT) → 플러그인 옵션(훅에만 전달됨) → 훅이 남긴 설정 파일 → 기본값.
// 에이전트가 실행하는 명령에는 플러그인 옵션이 전달되지 않으므로, 훅이 본 값을 설정 파일에 남겨 둔다.
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { readJson, writeJson } from './fsx.mjs'

const env = name => process.env[name] || process.env[name.toLowerCase()] || null
// 공식 문서: 훅 프로세스에 CLAUDE_PLUGIN_OPTION_<KEY>(대문자)로 전달된다. 설정하지 않은 값의 모양은 문서에 없어
// 빈 값과 치환되지 않은 글(${...})은 없는 것으로 본다.
const option = key => {
  const v = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`]
  return v && !v.includes('${') ? v : null
}

export const configDir = () => resolve(process.env.PM_CONFIG_DIR || join(homedir(), '.project-memory'))
const configFile = () => join(configDir(), 'config.json')
const saved = () => readJson(configFile(), {})

export function projectRoot() {
  return resolve(env('PM_ROOT') ?? option('project_root') ?? saved().projectRoot ?? join(homedir(), 'project-memory'))
}

export function personalRoot() {
  return resolve(env('PM_ME_ROOT') ?? option('personal_root') ?? saved().personalRoot ?? join(homedir(), 'personal-memory'))
}

/** 훅에서 부른다. 플러그인 옵션으로 받은 위치를 설정 파일에 남긴다(바뀐 경우에만 쓴다). */
export function rememberRoots() {
  const project = option('project_root')
  const personal = option('personal_root')
  if (!project && !personal) return
  const current = saved()
  const next = { ...current, ...(project ? { projectRoot: resolve(project) } : {}), ...(personal ? { personalRoot: resolve(personal) } : {}) }
  if (next.projectRoot !== current.projectRoot || next.personalRoot !== current.personalRoot) {
    writeJson(configFile(), { ...next, updated: new Date().toISOString() })
  }
}
