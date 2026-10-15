import { spawn } from 'node:child_process'
import { pmRoot } from '../lib/root.mjs'
import { parseArgs, out } from '../lib/cli.mjs'
import { buildViewer } from '../lib/viewer.mjs'

/** pm view [--no-open] — 커밋된 내용으로 뷰어를 만들고 브라우저로 연다. */
export async function run(argv) {
  const { values } = parseArgs(argv, { 'no-open': { type: 'boolean' } })
  const path = buildViewer(pmRoot())
  out(`뷰어: ${path}`)
  if (!values['no-open']) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', path]]
      : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]]
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
  return 0
}
