import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, writeFileSync, readdirSync, utimesSync } from 'node:fs'
import { makePmRoot, write, git, runPm, tempDir } from './helpers.mjs'
import { seedProject, P } from './fixtures/seed.mjs'
import { bundleHash } from '../lib/sources.mjs'
import { updateState } from '../lib/session.mjs'
import { checkout } from '../lib/drafts.mjs'

const S = ['--agent', 'claude', '--session', 's1', '--project', 'p']

function meshFolder() {
  const dir = tempDir('pm-src-')
  write(dir, 'sample-meshes/README.md', '# 메시\n')
  write(dir, 'sample-meshes/manifest.json', '{"a":1}\n')
  write(dir, 'sample-meshes/drive.glb', Buffer.from([0, 1, 2, 3, 255]))
  return join(dir, 'sample-meshes')
}

test('묶음 해시는 파일 순서·위치와 무관하게 재현된다', () => {
  const a = tempDir('pm-h-')
  write(a, 'x/1.txt', 'one')
  write(a, 'x/2.txt', 'two')
  const b = tempDir('pm-h-')
  write(b, 'x/2.txt', 'two')
  write(b, 'x/1.txt', 'one')
  assert.equal(bundleHash(join(a, 'x')), bundleHash(join(b, 'x')))
  write(b, 'x/1.txt', 'ONE')
  assert.notEqual(bundleHash(join(a, 'x')), bundleHash(join(b, 'x')))
})

test('add-source(폴더): 버전 폴더에 그대로 복사, 텍스트와 source.json 만 커밋, 원본은 그대로', () => {
  const root = seedProject(makePmRoot())
  const from = meshFolder()
  const r = runPm(['add-source', from, '--as', 'sample-meshes', '--date', '2026-10-11', '--note', 'CAD 추출', ...S], { root })
  assert.equal(r.code, 0, r.stderr)
  const sj = JSON.parse(readFileSync(join(root, `${P}/sources/sample-meshes/source.json`), 'utf8'))
  const [v] = sj.versions
  assert.match(v.id, /^2026-10-11-[0-9a-f]{8}$/)
  assert.equal(v.original_name, 'sample-meshes')
  assert.equal(v.bundle_sha256, bundleHash(from))
  const vdir = join(root, `${P}/sources/sample-meshes/${v.id}`)
  assert.deepEqual(readdirSync(vdir).sort(), ['README.md', 'drive.glb', 'manifest.json'])
  assert.deepEqual([...readFileSync(join(vdir, 'drive.glb'))], [0, 1, 2, 3, 255])
  const tracked = git(root, 'ls-files', `${P}/sources`).trim().split('\n')
  assert.ok(tracked.some(f => f.endsWith('README.md')))
  assert.ok(!tracked.some(f => f.endsWith('.glb')))
  assert.equal(git(root, 'status', '--porcelain'), '')
  assert.ok(existsSync(join(from, 'drive.glb')))
})

test('add-source: 같은 묶음은 다시 넣지 않는다', () => {
  const root = seedProject(makePmRoot())
  const from = meshFolder()
  assert.equal(runPm(['add-source', from, '--as', 'meshes2', ...S], { root }).code, 0)
  const again = runPm(['add-source', from, '--as', 'meshes2', ...S], { root })
  assert.notEqual(again.code, 0)
  assert.match(again.stderr, /이미/)
})

test('add-source(파일 하나): 한글 원래 이름은 기록하고 파일은 자료 이름으로', () => {
  const root = seedProject(makePmRoot())
  const dir = tempDir('pm-src-')
  const from = write(dir, '레일 씬그래프 설계 (4).html', '<html>설계</html>')
  const r = runPm(['add-source', from, '--as', 'rail-scene-graph-design', ...S], { root })
  assert.equal(r.code, 0, r.stderr)
  const sj = JSON.parse(readFileSync(join(root, `${P}/sources/rail-scene-graph-design/source.json`), 'utf8'))
  assert.equal(sj.versions[0].original_name, '레일 씬그래프 설계 (4).html')
  const vdir = join(root, `${P}/sources/rail-scene-graph-design/${sj.versions[0].id}`)
  assert.deepEqual(readdirSync(vdir), ['rail-scene-graph-design.html'])
})

test('new: 프로젝트 틀을 만들고 커밋한다. 규칙에 안 맞거나 이미 있으면 거부', () => {
  const root = makePmRoot()
  const r = runPm(['new', 'acme-paint-cell', '--title', 'ACME 도장 셀', '--summary', '도장 셀 운전·모션 UI', '--repo', 'github.com/example-org/web-app'], { root })
  assert.equal(r.code, 0, r.stderr)
  const pj = readFileSync(join(root, 'projects/acme-paint-cell/project.md'), 'utf8')
  assert.match(pj, /title: ACME 도장 셀/)
  assert.match(pj, /github\.com\/example-org\/web-app/)
  assert.equal(git(root, 'status', '--porcelain'), '')
  assert.notEqual(runPm(['new', 'Bad_Name', '--title', 't', '--summary', 's'], { root }).code, 0)
  assert.notEqual(runPm(['new', 'acme-paint-cell', '--title', 't', '--summary', 's'], { root }).code, 0)
})

test('status --prune: 30일 지난 세션 중 변경안이 없는 것만 지운다', () => {
  const root = seedProject(makePmRoot())
  updateState(root, 'claude', 'old-empty', { cwd: 'C:/x' })
  updateState(root, 'claude', 'old-drafts', { cwd: 'C:/x' })
  checkout(root, { agent: 'claude', session: 'old-drafts', project: 'p', paths: ['knowledge/rail.md'] })
  updateState(root, 'claude', 'fresh', { cwd: 'C:/x' })
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000)
  for (const s of ['old-empty', 'old-drafts']) {
    const f = join(root, 'runtime/sessions/claude', s, 'state.json')
    const st = JSON.parse(readFileSync(f, 'utf8'))
    writeFileSync(f, JSON.stringify({ ...st, updated: old.toISOString() }))
    utimesSync(f, old, old)
  }
  const r = runPm(['status', '--prune'], { root })
  assert.equal(r.code, 0, r.stderr)
  const left = readdirSync(join(root, 'runtime/sessions/claude')).sort()
  assert.deepEqual(left, ['fresh', 'old-drafts'])
  assert.match(r.stdout, /old-drafts/)
})

test('status: 세션을 주면 판정과 주입될 글 미리보기(상태 파일은 바꾸지 않음)', () => {
  const root = seedProject(makePmRoot())
  runPm(['use', 'p', '--agent', 'claude', '--session', 's1'], { root })
  const r = runPm(['status', '--agent', 'claude', '--session', 's1'], { root })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /판정: p \(use\)/)
  assert.match(r.stdout, /\[프로젝트 메모리\] p/)
})
