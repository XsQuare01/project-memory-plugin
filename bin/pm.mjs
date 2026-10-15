#!/usr/bin/env node
// 프로젝트 메모리 명령의 단일 진입점. 기능은 bin/lib/ 의 모듈에 있고, 여기서는 하위 명령을 나눠 부르기만 한다.
import { PmError } from './lib/errors.mjs'

// 하위 명령 → 그 명령을 담은 모듈. 모듈은 부를 때만 읽어 훅의 시작 시간을 줄인다.
const COMMANDS = {
  context: () => import('./commands/context.mjs'),
  turn: () => import('./commands/turn.mjs'),
  checkout: () => import('./commands/checkout.mjs'),
  apply: () => import('./commands/apply.mjs'),
  recover: () => import('./commands/recover.mjs'),
  toc: () => import('./commands/toc.mjs'),
  use: () => import('./commands/use.mjs'),
  link: () => import('./commands/link.mjs'),
  unlink: () => import('./commands/unlink.mjs'),
  'register-repo': () => import('./commands/register-repo.mjs'),
  'add-source': () => import('./commands/add-source.mjs'),
  new: () => import('./commands/new.mjs'),
  status: () => import('./commands/status.mjs'),
  view: () => import('./commands/view.mjs'),
  install: () => import('./commands/install.mjs'),
  me: () => import('./commands/me.mjs'),
  unlock: () => import('./commands/unlock.mjs'),
}

const USAGE = `사용법: pm <명령> [인자]
명령: ${Object.keys(COMMANDS).join(', ') || '(없음)'}`

async function main(argv) {
  const [name, ...rest] = argv
  if (!name) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  const load = COMMANDS[name]
  if (!load) {
    process.stderr.write(`pm: 모르는 명령 '${name}'\n${USAGE}\n`)
    return 2
  }
  const mod = await load()
  return (await mod.run(rest)) ?? 0
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code },
  err => {
    if (err instanceof PmError) {
      process.stderr.write(`pm: ${err.message}\n`)
      process.exitCode = err.code
    } else {
      process.stderr.write(`pm: 예상하지 못한 오류 — ${err?.stack ?? err}\n`)
      process.exitCode = 1
    }
  },
)
