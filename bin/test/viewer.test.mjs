import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { makePmRoot, write, git, runPm, tempDir } from './helpers.mjs'
import { remember } from '../lib/me-store.mjs'
import { seedProject, docs, P } from './fixtures/seed.mjs'
import { buildViewerData, renderViewerHtml } from '../lib/viewer.mjs'
import { pinHead } from '../lib/snapshot.mjs'

function embedded(html) {
  const m = /<script type="application\/json" id="pm-data">([\s\S]*?)<\/script>/.exec(html)
  return JSON.parse(m[1])
}

test('뷰어 데이터: 커밋된 문서·자료와 자료를 근거로 쓰는 문서', () => {
  const root = seedProject(makePmRoot())
  const data = buildViewerData(root, pinHead(root))
  const p = data.projects.find(x => x.name === 'p')
  assert.equal(p.title, '테스트 과제')
  assert.ok(p.docs.some(d => d.rel === 'decisions/2026-10-07-k3.md'))
  const meshes = p.sources.find(s => s.name === 'meshes')
  assert.deepEqual(meshes.usedBy, ['knowledge/rail.md'])
  assert.deepEqual(meshes.versions[0].files, ['README.md'])
})

test('뷰어 데이터는 커밋된 내용만 본다', () => {
  const root = seedProject(makePmRoot())
  write(root, `${P}/knowledge/rail.md`, docs.proposed.replace('레일 노드 구조 해석', '커밋 안 된 요약'))
  const p = buildViewerData(root, pinHead(root)).projects[0]
  assert.equal(p.docs.find(d => d.rel === 'knowledge/rail.md').data.summary, '레일 노드 구조 해석')
})

test('본문에 </script> 가 있어도 HTML 이 깨지지 않고, 렌더는 DOMPurify 를 거친다', () => {
  const root = seedProject(makePmRoot())
  write(root, `${P}/knowledge/evil.md`, docs.proposed.replace('첫 줄', '</script><script>alert(1)</script><img src=x onerror=alert(2)>'))
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'evil')
  const html = renderViewerHtml(buildViewerData(root, pinHead(root)))
  const data = embedded(html)
  assert.match(data.projects[0].docs.find(d => d.rel === 'knowledge/evil.md').body, /<\/script><script>alert\(1\)/)
  // 앱 코드(마지막 script)만 본다. 넣은 라이브러리는 내부에서 innerHTML 을 쓴다.
  const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1]
  assert.match(app, /DOMPurify\.sanitize\(marked\.parse\(/)
  assert.doesNotMatch(app, /\.innerHTML\s*=(?!\s*DOMPurify\.sanitize\()/)
  assert.equal((html.match(/<\/script>/g) ?? []).length, 4)
  // 앱 코드가 문법적으로 올바른지(문자열 안에 실제 줄바꿈이 끼는 실수 등)
  assert.doesNotThrow(() => new Function(app))
})

test('뷰어 데이터에 사용자 메모리 항목이 따로 들어가고, 화면에 "사용자 메모리" 선택지가 있다', () => {
  const root = seedProject(makePmRoot())
  const meRootDir = tempDir('pm-me-')
  remember(meRootDir, { id: 'explain-first', text: '설명은 결론부터', kind: 'preference', scope: 'global', core: true, source: 's', by: 'claude/s1' })
  const data = buildViewerData(root, pinHead(root), { meRootDir })
  assert.deepEqual(data.personal.map(i => i.id), ['explain-first'])
  assert.equal(data.projects.some(p => p.name === '__me'), false)
  assert.match(renderViewerHtml(data), /사용자 메모리/)
})

test('pm view --no-open: viewer/index.html 을 만들고 경로를 알린다', () => {
  const root = seedProject(makePmRoot())
  const r = runPm(['view', '--no-open'], { root })
  assert.equal(r.code, 0, r.stderr)
  const file = join(root, 'viewer', 'index.html')
  assert.ok(existsSync(file))
  assert.match(r.stdout, /index\.html/)
  assert.ok(embedded(readFileSync(file, 'utf8')).projects.length === 1)
})

test('apply 뒤에 뷰어를 다시 만든다', () => {
  const root = seedProject(makePmRoot())
  const co = runPm(['checkout', 'questions/manual-stop.md', '--agent', 'claude', '--session', 's', '--project', 'p'], { root })
  const path = co.stdout.match(/변경안: (.+)/)[1].trim()
  writeFileSync(path, docs.question.replace('수동에서 레일이 멈추나', '뷰어 갱신 확인'))
  assert.equal(runPm(['apply', '-m', 'm', '--agent', 'claude', '--session', 's', '--project', 'p'], { root }).code, 0)
  const html = readFileSync(join(root, 'viewer', 'index.html'), 'utf8')
  assert.match(html, /뷰어 갱신 확인/)
})
