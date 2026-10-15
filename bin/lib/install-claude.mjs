// Claude Code 연결부 설치 (설계 8). 넣는 것: SessionStart·UserPromptSubmit 훅, /project 스킬,
// CLAUDE.md 절(표시 주석 사이), 커밋 차단 훅의 의도한 예외 주석. 바꾸는 파일은 먼저 백업한다. --remove 로 걷어 낸다.
import { readFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { atomicWrite, readIfExists } from './fsx.mjs'
import { PM_PATH } from './hooks.mjs'

const ADAPTER = fileURLToPath(new URL('../../adapters/claude/', import.meta.url))
const BEGIN = '<!-- project-memory:begin -->'
const END = '<!-- project-memory:end -->'
const SH_MARK = '# [project-memory] 의도한 예외'
const SH_NOTE = [
  `${SH_MARK}: 프로젝트 메모리(과제 데이터 저장소)는 \`node …/pm.mjs\` 쓰기 명령`,
  '# (apply·add-source·new·link·unlink)이 커밋한다. 그 명령은 `git … commit` 꼴이 아니라 아래 정규식에 걸리지 않으며,',
  '# 우연한 구멍이 아니라 2026-10-14 설계(판 4, 6.8)로 정한 예외다. 그 외 저장소의 차단은 그대로다.',
]

export const claudeHome = () => process.env.PM_CLAUDE_HOME ?? join(homedir(), '.claude')
const hookCommand = kind => `node "${PM_PATH}" ${kind} --agent claude`
const isOurs = cmd => typeof cmd === 'string' && /pm\.mjs"? (context|turn) --agent claude/.test(cmd)

function withHooks(settings, add) {
  const next = structuredClone(settings)
  next.hooks ??= {}
  for (const [event, kind, status] of [['SessionStart', 'context', '프로젝트 메모리 확인'], ['UserPromptSubmit', 'turn', '프로젝트 메모리 확인']]) {
    const groups = (next.hooks[event] ?? [])
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h.command)) }))
      .filter(g => g.hooks.length)
    if (add) groups.push({ hooks: [{ type: 'command', command: hookCommand(kind), timeout: 10, statusMessage: status }] })
    if (groups.length) next.hooks[event] = groups
    else delete next.hooks[event]
  }
  return next
}

function withSection(md, add) {
  const re = new RegExp(`\\n*${BEGIN}[\\s\\S]*?${END}\\n?`)
  const base = md.replace(re, '\n').replace(/\n+$/, '\n')
  if (!add) return base
  const section = readFileSync(join(ADAPTER, 'claude-md.md'), 'utf8').trim()
  return `${base}\n${BEGIN}\n${section}\n${END}\n`
}

function withNote(sh, add) {
  const lines = sh.split('\n').filter(l => !l.startsWith('# [project-memory]') && !SH_NOTE.slice(1).includes(l))
  if (add) lines.splice(lines[0]?.startsWith('#!') ? 1 : 0, 0, ...SH_NOTE)
  return lines.join('\n')
}

/** 바꿀 내용을 계산한다. 반환: [{ path, before(Buffer|null), after(Buffer|null 삭제), label }] */
export function planClaude({ remove = false } = {}) {
  const home = claudeHome()
  const plan = []
  const settingsPath = join(home, 'settings.json')
  const settingsBuf = readIfExists(settingsPath)
  const settings = settingsBuf ? JSON.parse(settingsBuf.toString('utf8')) : {}
  const nextSettings = withHooks(settings, !remove)
  // 내용이 같으면(줄바꿈·들여쓰기만 다른 경우 포함) 사용자 설정 파일을 다시 쓰지 않는다.
  if (JSON.stringify(nextSettings) !== JSON.stringify(settings)) {
    plan.push({ path: settingsPath, before: settingsBuf, after: Buffer.from(`${JSON.stringify(nextSettings, null, 2)}\n`), label: 'settings.json 훅(SessionStart·UserPromptSubmit)' })
  }

  const mdPath = join(home, 'CLAUDE.md')
  const md = readIfExists(mdPath)?.toString('utf8') ?? ''
  plan.push({ path: mdPath, before: md ? Buffer.from(md) : null, after: Buffer.from(withSection(md, !remove)), label: 'CLAUDE.md 프로젝트 메모리 절' })

  const shPath = join(home, 'hooks', 'block-git-commit.sh')
  const sh = readIfExists(shPath)
  if (sh) plan.push({ path: shPath, before: sh, after: Buffer.from(withNote(sh.toString('utf8'), !remove)), label: 'block-git-commit.sh 의도한 예외 주석' })

  const skillPath = join(home, 'skills', 'project', 'SKILL.md')
  plan.push({
    path: skillPath,
    before: readIfExists(skillPath),
    after: remove ? null : readFileSync(join(ADAPTER, 'skill', 'SKILL.md')),
    label: '/project 스킬',
  })
  return plan.filter(p => !(p.before === null && p.after === null) && !(p.before && p.after && p.before.equals(p.after)))
}

export function applyPlan(plan, stamp) {
  const backups = []
  for (const p of plan) {
    if (p.before !== null && !p.path.endsWith('SKILL.md')) {
      const backup = `${p.path}.bak-pm-${stamp}`
      copyFileSync(p.path, backup)
      backups.push(backup)
    }
    if (p.after === null) {
      rmSync(dirname(p.path), { recursive: true, force: true })
    } else {
      mkdirSync(dirname(p.path), { recursive: true })
      atomicWrite(p.path, p.after)
    }
  }
  return backups
}
