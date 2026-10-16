// 실행에 필요한 외부 패키지를 bin/vendor/ 에 넣는다(npm run vendor).
// 플러그인 설치기(Codex)는 npm 패키지를 깔지 않으므로, 설치본은 node_modules 없이 돌아야 한다.
// 패키지 버전을 바꾸면 이 스크립트를 다시 돌리고 결과를 함께 커밋한다(버전 일치는 테스트가 확인한다).
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MODULES = join(ROOT, 'node_modules')
const OUT = join(ROOT, 'bin', 'vendor')
const pkg = name => JSON.parse(readFileSync(join(MODULES, name, 'package.json'), 'utf8'))

mkdirSync(OUT, { recursive: true })
const versions = {}

// yaml: 여러 파일로 된 CommonJS 라 한 파일로 묶는다(훅이 동기로 require 한다).
const yaml = pkg('yaml')
await build({
  entryPoints: [join(MODULES, 'yaml', 'dist', 'index.js')],
  outfile: join(OUT, 'yaml.cjs'),
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  legalComments: 'inline',
  banner: { js: `/*! yaml ${yaml.version} | ${yaml.license} | 묶음: npm run vendor */` },
})
versions.yaml = yaml.version

// 뷰어 HTML 에 그대로 넣는 브라우저용 파일.
for (const [name, file, out] of [
  ['marked', 'lib/marked.umd.js', 'marked.umd.js'],
  ['dompurify', 'dist/purify.min.js', 'purify.min.js'],
]) {
  copyFileSync(join(MODULES, name, file), join(OUT, out))
  versions[name] = pkg(name).version
}

for (const [name, files] of [['yaml', ['LICENSE']], ['marked', ['LICENSE']], ['dompurify', ['LICENSE', 'LICENSE-MPL']]]) {
  for (const f of files) copyFileSync(join(MODULES, name, f), join(OUT, `${name}.${f}`))
}

writeFileSync(join(OUT, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`)
console.log(`bin/vendor 갱신: ${Object.entries(versions).map(([k, v]) => `${k}@${v}`).join(', ')}`)
