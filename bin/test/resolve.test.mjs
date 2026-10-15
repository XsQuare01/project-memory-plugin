import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { makePmRoot, makeUserRepo, write, git, runPm } from './helpers.mjs'
import { seedProject, docs } from './fixtures/seed.mjs'
import { parseRemote, repoInfo } from '../lib/repo.mjs'
import { resolveProject } from '../lib/resolve.mjs'
import { readState, updateState, recentSelectionInCwd } from '../lib/session.mjs'

const REMOTE = 'https://github.com/Example-Org/web-app.git'

function setup() {
  const root = seedProject(makePmRoot())
  write(root, 'projects/p2/project.md', docs.project.replace('테스트 과제', '두 번째 과제'))
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'p2')
  return root
}
const S = (session = 's1') => ['--agent', 'claude', '--session', session]

test('원격 주소 → 호스트/소유자/이름', () => {
  const want = 'github.com/example-org/web-app'
  for (const url of [
    REMOTE,
    'https://user@github.com/Example-Org/web-app',
    'git@github.com:Example-Org/web-app.git',
    'ssh://git@github.com/Example-Org/web-app.git',
    'ssh://git@github.com:22/example-org/web-app',
  ]) assert.equal(parseRemote(url), want, url)
  assert.equal(parseRemote('C:/repos/local'), null)
  assert.equal(parseRemote(''), null)
})

test('repoInfo: 원격이 있으면 식별자, 없으면 null, 분리된 HEAD 는 브랜치 없음', () => {
  const withRemote = makeUserRepo({ remote: REMOTE })
  assert.equal(repoInfo(withRemote).id, 'github.com/example-org/web-app')
  assert.equal(repoInfo(withRemote).branch, 'main')
  const bare = makeUserRepo()
  assert.equal(repoInfo(bare).id, null)
  git(bare, 'checkout', '-q', '--detach')
  assert.equal(repoInfo(bare).branch, null)
  assert.equal(repoInfo(join(bare, '..')), null)
})

test('register-repo: 원격 없는 저장소에 ID 를 붙인다', () => {
  const root = setup()
  const repo = makeUserRepo()
  const r = runPm(['register-repo', 'local/my-repo'], { root, cwd: repo })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(repoInfo(repo, root).id, 'local/my-repo')
})

test('link: 브랜치 설정과 links.json 을 쓰고 커밋하며, 판정은 브랜치 연결', () => {
  const root = setup()
  const repo = makeUserRepo({ remote: REMOTE })
  git(repo, 'switch', '-q', '-c', 'feat/sample-feature')
  const r = runPm(['link', 'p', ...S()], { root, cwd: repo })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(git(repo, 'config', '--get', 'branch.feat/sample-feature.pm-project').trim(), 'p')
  const links = JSON.parse(readFileSync(join(root, 'links.json'), 'utf8'))
  assert.equal(links['github.com/example-org/web-app@feat/sample-feature'].project, 'p')
  assert.equal(git(root, 'status', '--porcelain'), '')
  assert.deepEqual(resolveProject(root, { agent: 'claude', session: 's9', cwd: repo }), { project: 'p', via: 'link' })
})

test('연결은 rebase·이름 바꾸기를 따라가고, 지웠다 다시 만든 브랜치에는 없다', () => {
  const root = setup()
  const repo = makeUserRepo({ remote: REMOTE })
  git(repo, 'switch', '-q', '-c', 'feat/x')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'x1')
  runPm(['link', 'p', ...S()], { root, cwd: repo })
  const who = () => resolveProject(root, { agent: 'claude', session: 'z', cwd: repo })
  git(repo, 'switch', '-q', 'main')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'm2')
  git(repo, 'switch', '-q', 'feat/x')
  git(repo, 'rebase', '-q', 'main')
  assert.equal(who()?.project, 'p')
  git(repo, 'branch', '-m', 'feat/y')
  assert.equal(who()?.project, 'p')
  git(repo, 'switch', '-q', 'main')
  git(repo, 'branch', '-q', '-D', 'feat/y')
  git(repo, 'switch', '-q', '-c', 'feat/y')
  assert.equal(who(), null)
})

test('세션 선택이 브랜치 연결보다 먼저다', () => {
  const root = setup()
  const repo = makeUserRepo({ remote: REMOTE })
  runPm(['link', 'p', ...S()], { root, cwd: repo })
  assert.equal(runPm(['use', 'p2', ...S('s2')], { root, cwd: repo }).code, 0)
  assert.deepEqual(resolveProject(root, { agent: 'claude', session: 's2', cwd: repo }), { project: 'p2', via: 'use' })
  assert.deepEqual(resolveProject(root, { agent: 'claude', session: 's3', cwd: repo }), { project: 'p', via: 'link' })
})

test('브랜치 A→B 전환: 마지막 주입 기록이 선택으로 굳지 않는다', () => {
  const root = setup()
  const repo = makeUserRepo({ remote: REMOTE })
  git(repo, 'switch', '-q', '-c', 'branch-a')
  runPm(['link', 'p', ...S()], { root, cwd: repo })
  updateState(root, 'claude', 's1', { last_injected: { project: 'p', revision: 'r', via: 'link' } })
  git(repo, 'switch', '-q', '-c', 'branch-b')
  assert.equal(resolveProject(root, { agent: 'claude', session: 's1', cwd: repo }), null)
  assert.equal(readState(root, 'claude', 's1').selection, null)
})

test('use: 없는 프로젝트는 거부, --clear 로 선택 해제', () => {
  const root = setup()
  assert.notEqual(runPm(['use', 'nope', ...S()], { root }).code, 0)
  runPm(['use', 'p', ...S()], { root })
  assert.equal(readState(root, 'claude', 's1').selection.project, 'p')
  runPm(['use', '--clear', ...S()], { root })
  assert.equal(readState(root, 'claude', 's1').selection, null)
})

test('link 의 links.json 커밋이 실패하면 그 설정 키만 되돌린다', () => {
  const root = setup()
  const repo = makeUserRepo({ remote: REMOTE })
  git(repo, 'config', 'pm-test.other', 'keep')
  const head = git(root, 'rev-parse', 'HEAD')
  const r = runPm(['link', 'p', ...S()], { root, cwd: repo, env: { PM_TEST_FAULT: 'commit-fail' } })
  assert.notEqual(r.code, 0)
  assert.throws(() => git(repo, 'config', '--get', 'branch.main.pm-project'))
  assert.equal(git(repo, 'config', '--get', 'pm-test.other').trim(), 'keep')
  assert.equal(git(root, 'rev-parse', 'HEAD'), head)
  assert.equal(git(root, 'status', '--porcelain'), '')
})

test('unlink: 설정과 links.json 항목을 지운다', () => {
  const root = setup()
  const repo = makeUserRepo({ remote: REMOTE })
  runPm(['link', 'p', ...S()], { root, cwd: repo })
  const r = runPm(['unlink', ...S()], { root, cwd: repo })
  assert.equal(r.code, 0, r.stderr)
  assert.throws(() => git(repo, 'config', '--get', 'branch.main.pm-project'))
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'links.json'), 'utf8')), {})
})

test('같은 폴더의 최근 선택: 2시간 안·같은 도구·같은 폴더만, 자기 세션 제외', () => {
  const root = setup()
  const now = Date.parse('2026-10-14T12:00:00Z')
  updateState(root, 'claude', 'old', { cwd: 'C:/work', selection: { project: 'p', at: '2026-10-14T09:00:00Z' } })
  updateState(root, 'claude', 'recent', { cwd: 'C:/work', selection: { project: 'p2', at: '2026-10-14T11:30:00Z' } })
  updateState(root, 'codex', 'other-agent', { cwd: 'C:/work', selection: { project: 'p', at: '2026-10-14T11:59:00Z' } })
  assert.equal(recentSelectionInCwd(root, { agent: 'claude', cwd: 'c:\\work', exclude: 'new', now }), 'p2')
  assert.equal(recentSelectionInCwd(root, { agent: 'claude', cwd: 'C:/elsewhere', exclude: 'new', now }), null)
  assert.equal(recentSelectionInCwd(root, { agent: 'claude', cwd: 'C:/work', exclude: 'recent', now }), null)
})
