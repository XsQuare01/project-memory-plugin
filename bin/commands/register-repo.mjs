import { pmRoot } from '../lib/root.mjs'
import { parseArgs, out } from '../lib/cli.mjs'
import { PmError } from '../lib/errors.mjs'
import { repoInfo, registerRepo } from '../lib/repo.mjs'

const ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)+$/

/** pm register-repo <ID> — 원격이 없는 저장소에 식별자를 붙인다(이 PC 에서만, runtime/repos.json). */
export async function run(argv) {
  const { positionals } = parseArgs(argv)
  const [id] = positionals
  if (!id || !ID.test(id)) throw new PmError('사용법: pm register-repo <소문자 ID, 예: local/my-repo>', 2)
  const root = pmRoot()
  const repo = repoInfo(process.cwd(), root)
  if (!repo) throw new PmError('지금 폴더는 git 저장소가 아닙니다')
  registerRepo(root, repo.commonDir, id)
  out(`등록: ${repo.top} → ${id}`)
  return 0
}
