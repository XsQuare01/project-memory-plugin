import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pmRoot } from '../lib/root.mjs'
import { parseArgs, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { assertProjectName } from '../lib/names.mjs'
import { serializeDoc, validateDoc } from '../lib/frontmatter.mjs'
import { withLock, commitTx } from '../lib/tx.mjs'
import { localToday } from '../lib/apply.mjs'
import { rebuildViewerQuietly } from '../lib/viewer.mjs'

const BODY = `## 개요

(이 과제가 무엇을 만드는지 두세 줄)

## 관련 저장소

## 사람과 역할

## 외부 링크
`

/** pm new <이름> --title <한글 제목> --summary <한 줄> [--repo <식별자>]… — 프로젝트 틀을 만든다. */
export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    title: { type: 'string' },
    summary: { type: 'string' },
    repo: { type: 'string', multiple: true },
  })
  const [name] = positionals
  if (!name) throw new PmError('사용법: pm new <이름> --title <제목> --summary <한 줄 요약> [--repo <식별자>]…', 2)
  assertProjectName(name)
  const data = { title: values.title ?? '', summary: values.summary ?? '', repos: values.repo ?? [], created: localToday() }
  const errors = validateDoc('project.md', data)
  if (errors.length) throw new PmError(`project.md — ${errors.join('; ')}`, 2)
  const root = pmRoot()
  const agent = values.agent ?? 'user'
  const session = values.session ?? 'cli'
  const r = withLock(root, { agent, session }, () => {
    if (existsSync(join(root, 'projects', name))) throw new PmError(`프로젝트 '${name}' 가 이미 있습니다`)
    const dir = `projects/${name}`
    return commitTx(root, {
      files: [
        { path: `${dir}/project.md`, data: Buffer.from(serializeDoc(data, BODY)) },
        ...['knowledge', 'decisions', 'questions', 'sources'].map(d => ({ path: `${dir}/${d}/.gitkeep`, data: Buffer.alloc(0) })),
      ],
      message: `새 프로젝트: ${name}`,
      trailers: { Project: name, Agent: agent, Session: session, Via: 'new' },
    })
  })
  out(`새 프로젝트: ${name} (커밋 ${r.commit.slice(0, 9)})`)
  out(`다음: 이 브랜치에 연결하려면 pm link ${name}, 이 세션에서만 쓰려면 pm use ${name}`)
  rebuildViewerQuietly(root)
  return 0
}
