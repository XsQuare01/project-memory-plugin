// 과제 데이터 저장소의 루트(사용자가 정한 위치). 비어 있으면 첫 쓰기 때 저장소로 준비한다.
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './roots.mjs'
import { PmError } from './errors.mjs'
import { git } from './git.mjs'

export function pmRoot() {
  return projectRoot()
}

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url))
// pm 이 스스로 만드는 폴더만 있으면 "빈 폴더"로 본다(훅이 세션 상태를 먼저 남겼을 수 있다).
const OWN = new Set(['runtime', 'viewer'])

/** 데이터 저장소가 없으면 만든다: git init, .gitattributes·.gitignore·links.json, 첫 커밋. */
export function ensureDataRoot(root) {
  if (existsSync(join(root, '.git'))) return false
  mkdirSync(root, { recursive: true })
  const foreign = readdirSync(root).filter(name => !OWN.has(name))
  if (foreign.length) {
    throw new PmError(`데이터 위치 '${root}' 가 비어 있지 않고 git 저장소도 아닙니다 — 빈 폴더나 기존 프로젝트 메모리 저장소를 지정하세요`)
  }
  git(root, ['init', '-q', '-b', 'main'])
  writeFileSync(join(root, '.gitattributes'), '# 해시를 바이트 기준으로 비교하므로 줄바꿈 변환을 하지 않는다.\n* -text\n')
  writeFileSync(join(root, '.gitignore'), readFileSync(join(TEMPLATES, 'data.gitignore')))
  writeFileSync(join(root, 'links.json'), '{}\n')
  git(root, ['add', '--', '.gitattributes', '.gitignore', 'links.json'])
  git(root, ['commit', '-q', '-m', '프로젝트 메모리 데이터 저장소 시작', '--trailer', 'Via: init', '--', '.gitattributes', '.gitignore', 'links.json'])
  return true
}
