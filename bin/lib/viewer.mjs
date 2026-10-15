// 로컬 HTML 뷰어 (설계 9). 고정 커밋에서 읽은 내용을 HTML 한 파일에 넣는다. 인터넷 없이 열린다.
// 렌더한 마크다운은 DOMPurify 로 정화한 뒤에만 화면에 넣고, 나머지 글은 모두 textContent 로 넣는다.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWrite } from './fsx.mjs'
import { pinHead, listProjects, readProject, readBlobs } from './snapshot.mjs'
import { meRoot, readItems } from './me-store.mjs'

// 패키지의 exports 가 브라우저용 파일 경로를 막으므로 node_modules 에서 경로로 직접 읽는다.
const NODE_MODULES = fileURLToPath(new URL('../../node_modules/', import.meta.url))
const vendor = rel => readFileSync(join(NODE_MODULES, rel), 'utf8').replace(/<\/script/gi, '<\\/script')

function diskFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  const walk = (d, prefix) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name)
      if (statSync(abs).isDirectory()) walk(abs, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  walk(dir, '')
  return out
}

/** 뷰어에 넣을 데이터. 문서는 커밋된 내용, 자료 파일 목록은 커밋된 텍스트 + 디스크의 바이너리, 사용자 메모리는 따로. */
export function buildViewerData(root, commit, { meRootDir = meRoot() } = {}) {
  let personal = []
  try {
    personal = readItems(meRootDir).map(i => ({ id: i.id, data: i.data, body: i.body }))
  } catch (err) {
    process.stderr.write(`pm: 뷰어에 사용자 메모리를 넣지 못했습니다 — ${err.message}\n`)
  }
  return { ...buildProjectData(root, commit), personal }
}

function buildProjectData(root, commit) {
  const projects = []
  for (const name of listProjects(root, commit)) {
    const snap = readProject(root, commit, name)
    const docs = snap.docs.map(d => ({ rel: d.rel, kind: d.kind, data: d.data, body: d.body }))
    const sourceJsons = snap.files.filter(f => /^sources\/[^/]+\/source\.json$/.test(f))
    const blobs = readBlobs(root, commit, sourceJsons.map(f => `projects/${name}/${f}`))
    const sources = sourceJsons.map(f => {
      const sname = f.split('/')[1]
      let sj = {}
      try { sj = JSON.parse(blobs.get(`projects/${name}/${f}`)?.toString('utf8') ?? '{}') } catch { sj = {} }
      const versions = (sj.versions ?? []).map(v => {
        const tree = snap.files.filter(p => p.startsWith(`sources/${sname}/${v.id}/`)).map(p => p.slice(`sources/${sname}/${v.id}/`.length))
        const disk = diskFiles(join(root, 'projects', name, 'sources', sname, v.id))
        return { ...v, files: [...new Set([...tree, ...disk])].sort() }
      })
      const usedBy = docs
        .filter(d => (d.data.evidence ?? []).some(e => typeof e?.source === 'string' && e.source.split('@')[0] === sname))
        .map(d => d.rel)
      return { name: sname, title: sj.title ?? sname, versions, usedBy }
    })
    projects.push({
      name,
      title: snap.projectDoc?.data?.title ?? name,
      summary: snap.projectDoc?.data?.summary ?? '',
      overview: snap.projectDoc?.body ?? '',
      docs,
      sources,
    })
  }
  return { generatedAt: new Date().toISOString(), commit, projects }
}

const CSS = `
:root {
  --paper: #f4f6f7; --panel: #ffffff; --ink: #1e282e; --steel: #5a6a73; --line: #d7dee2;
  --settled: #0d6b66; --tentative: #6a55a3; --open: #a86e00; --dim: #9aa6ad; --focus: #2b6cb0;
  --chip: #e8edf0;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #141a1d; --panel: #1b2226; --ink: #dce4e8; --steel: #9aabb4; --line: #2c373d;
    --settled: #4fb3aa; --tentative: #a995e0; --open: #e0a63c; --dim: #66757d; --focus: #7fb0e8; --chip: #243036; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--paper); color: var(--ink);
  font: 15px/1.6 "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.top { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 20px;
  border-bottom: 1px solid var(--line); background: var(--panel); }
.top h1 { font-size: 17px; font-weight: 700; margin: 0 8px 0 0; letter-spacing: -0.01em; }
.top select, .top input { background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; }
.top input { flex: 1 1 240px; min-width: 0; }
.open-count { border: 1.5px solid var(--open); color: var(--open); background: transparent; border-radius: 999px;
  padding: 4px 12px; cursor: pointer; font-weight: 600; }
.open-count[aria-pressed="true"] { background: var(--open); color: var(--panel); }
.main { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; height: calc(100% - 61px); }
.list { border-right: 1px solid var(--line); overflow: auto; padding: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { border: 0; background: var(--chip); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 13px; }
.chip[aria-pressed="true"] { background: var(--ink); color: var(--panel); }
.group { font-size: 13px; color: var(--steel); margin: 14px 4px 6px; font-weight: 600; }
.entry { display: block; width: 100%; text-align: left; background: var(--panel); border: 1px solid var(--line);
  border-left-width: 4px; border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; }
.entry[aria-current="true"] { box-shadow: inset 0 0 0 1px var(--ink); }
.entry .t { font-weight: 600; display: block; }
.entry .s { color: var(--steel); font-size: 13px; display: block; }
.entry .m { color: var(--steel); font-size: 12px; display: flex; gap: 10px; margin-top: 2px; }
.mark-settled { border-left-color: var(--settled); border-left-style: solid; }
.mark-tentative { border-left-color: var(--tentative); border-left-style: dashed; }
.mark-open { border-left-color: var(--open); border-left-style: double; border-left-width: 5px; }
.mark-dim { border-left-color: var(--dim); opacity: .7; }
.mark-dim .t { text-decoration: line-through; text-decoration-color: var(--dim); }
.mark-source { border-left-color: var(--steel); }
.detail { overflow: auto; padding: 28px 36px; }
.detail article { max-width: 72ch; }
.detail h2 { font-size: 24px; line-height: 1.3; margin: 0 0 6px; letter-spacing: -0.015em; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--steel); font-size: 13px; margin: 0 0 14px; }
.facts b { color: var(--ink); font-weight: 600; }
.state { display: inline-block; border-radius: 4px; padding: 0 8px; font-size: 13px; font-weight: 600; border: 1.5px solid; }
.state.settled { color: var(--settled); } .state.tentative { color: var(--tentative); border-style: dashed; }
.state.open { color: var(--open); } .state.dim { color: var(--dim); }
.refs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; align-items: center; }
.refs span { color: var(--steel); font-size: 13px; }
.ref { border: 1px solid var(--line); background: var(--panel); border-radius: 4px; padding: 1px 8px; font-size: 13px; cursor: pointer; }
.ref.user { cursor: default; }
.body h1, .body h2, .body h3 { line-height: 1.35; margin: 1.4em 0 .5em; }
.body h1 { font-size: 20px; } .body h2 { font-size: 18px; } .body h3 { font-size: 16px; }
.body table { border-collapse: collapse; margin: 1em 0; font-size: 14px; }
.body th, .body td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.body code { background: var(--chip); border-radius: 3px; padding: 0 4px; font-family: "D2Coding", Consolas, monospace; font-size: .92em; }
.body pre { background: var(--chip); padding: 10px 12px; border-radius: 4px; overflow: auto; }
.body pre code { background: none; padding: 0; }
.files { list-style: none; padding: 0; } .files li { margin: 2px 0; }
.files a { color: var(--focus); }
.empty { color: var(--steel); padding: 24px 8px; }
.overview { color: var(--steel); }
@media (max-width: 760px) {
  .main { grid-template-columns: 1fr; height: auto; }
  .list { border-right: 0; border-bottom: 1px solid var(--line); max-height: 50vh; padding: 12px 16px; }
  .detail { padding: 20px 16px; }
  .top { padding: 12px 16px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`

const APP = String.raw`
(() => {
  const DATA = JSON.parse(document.getElementById('pm-data').textContent)
  const $ = s => document.querySelector(s)
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v
      else if (k === 'text') n.textContent = v
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
      else if (v !== undefined && v !== null) n.setAttribute(k, v)
    }
    for (const kid of kids) if (kid) n.append(kid)
    return n
  }
  const KIND = { decision: '결정', knowledge: '이해', question: '질문', source: '자료', me: '사용자 메모리' }
  const ME = '__me'
  const PERSONAL = DATA.personal || []
  const todayText = new Date().toLocaleDateString('sv-SE')
  const scopeText = d => (d.scope === 'global' ? '전역' : d.scope.replace(/^company:/, '회사 ').replace(/^project:/, '과제 ')) + (d.core ? ', 항상 주입' : '')
  const STATUS = { active: '유효', superseded: '대체됨', confirmed: '확정', proposed: '제안', open: '열림', resolved: '해결됨' }
  const markOf = e => e.kind === 'me' ? (e.me.data.review_after && e.me.data.review_after < todayText ? 'open' : 'settled')
    : e.kind === 'source' ? 'source'
    : e.status === 'superseded' || e.status === 'resolved' ? 'dim'
    : e.status === 'proposed' ? 'tentative' : e.status === 'open' ? 'open' : 'settled'
  const dateText = v => (v ? String(v).slice(0, 10) : '')
  const slug = rel => rel.split('/').pop().replace(/\.md$/, '')

  const state = { project: '', query: '', kind: 'all', status: 'all', selected: null }
  try { state.project = localStorage.getItem('pm.project') || '' } catch {}
  if (state.project !== ME && !DATA.projects.some(p => p.name === state.project)) state.project = DATA.projects.length === 1 ? DATA.projects[0].name : ''

  function entriesOf(p) {
    const docs = p.docs.map(d => ({
      key: p.name + '/' + d.rel, project: p.name, kind: d.kind, rel: d.rel, doc: d,
      title: d.data.title || slug(d.rel), summary: d.data.summary || '', status: d.data.status || '',
      date: dateText(d.data.date || d.data.updated || d.data.asked),
      text: [d.data.title, d.data.summary, d.body, d.rel].join('\n').toLowerCase(),
    }))
    const sources = p.sources.map(s => ({
      key: p.name + '/sources/' + s.name, project: p.name, kind: 'source', rel: 'sources/' + s.name, source: s,
      title: s.title, summary: s.versions.length + '개 버전, ' + s.usedBy.length + '개 문서가 근거로 씀', status: '',
      date: dateText(s.versions.at(-1)?.received),
      text: [s.title, s.name, ...s.versions.map(v => v.original_name + ' ' + (v.note || ''))].join('\n').toLowerCase(),
    }))
    return [...docs, ...sources]
  }
  function personalEntries() {
    return PERSONAL.map(i => ({
      key: ME + '/' + i.id, project: ME, kind: 'me', rel: i.id, me: i,
      title: i.data.text, summary: scopeText(i.data), status: '', date: dateText(i.data.confirmed),
      text: [i.id, i.data.text, i.data.scope, i.data.source, i.body].join(' ').toLowerCase(),
    }))
  }
  const projects = () => (state.project === ME ? [] : DATA.projects.filter(p => !state.project || p.name === state.project))
  const all = () => (state.project === ME ? personalEntries() : projects().flatMap(entriesOf))

  function visible() {
    const q = state.query.trim().toLowerCase()
    return all().filter(e =>
      (state.kind === 'all' || (state.kind === 'open' ? e.kind === 'question' && e.status === 'open' : e.kind === state.kind)) &&
      (state.status === 'all' || e.status === state.status) &&
      (!q || q.split(/\s+/).every(w => e.text.includes(w))))
  }

  function renderTop() {
    const sel = $('#project')
    sel.replaceChildren(el('option', { value: '', text: '모든 프로젝트' }),
      ...DATA.projects.map(p => el('option', { value: p.name, text: p.title + ' (' + p.name + ')' })),
      ...(PERSONAL.length ? [el('option', { value: ME, text: '사용자 메모리 (' + PERSONAL.length + ')' })] : []))
    sel.value = state.project
    const open = all().filter(e => e.kind === 'question' && e.status === 'open').length
    const btn = $('#open')
    btn.textContent = '열린 질문 ' + open
    btn.setAttribute('aria-pressed', String(state.kind === 'open'))
  }

  function renderChips() {
    const base = all()
    const count = k => base.filter(e => e.kind === k).length
    const chips = [['all', '전체 ' + base.length], ['decision', '결정 ' + count('decision')], ['knowledge', '이해 ' + count('knowledge')],
      ['question', '질문 ' + count('question')], ['source', '자료 ' + count('source')]]
    const statusChips = state.project === ME ? [] : [['all', '모든 상태'], ['confirmed', '확정만'], ['proposed', '제안만']]
    if (state.project === ME) chips.splice(1)
    $('#chips').replaceChildren(
      ...chips.map(([k, label]) => el('button', { class: 'chip', 'aria-pressed': String(state.kind === k), text: label,
        onclick: () => { state.kind = k; render() } })),
      ...statusChips.map(([k, label]) => el('button', { class: 'chip', 'aria-pressed': String(state.status === k), text: label,
        onclick: () => { state.status = k; render() } })))
  }

  function renderList() {
    const list = visible()
    const box = $('#entries')
    if (!list.length) {
      box.replaceChildren(el('p', { class: 'empty', text: '이 조건에 맞는 기록이 없습니다. 검색어를 지우거나 필터를 바꿔 보세요.' }))
      return
    }
    const order = ['decision', 'knowledge', 'question', 'source', 'me']
    const groups = order.map(k => [k, list.filter(e => e.kind === k)]).filter(([, l]) => l.length)
    const nodes = []
    for (const [k, items] of groups) {
      items.sort((a, b) => k === 'decision' ? (b.date.localeCompare(a.date) || a.rel.localeCompare(b.rel)) : a.rel.localeCompare(b.rel))
      nodes.push(el('div', { class: 'group', text: KIND[k] + ' ' + items.length }))
      for (const e of items) {
        nodes.push(el('button', {
          class: 'entry mark-' + markOf(e), 'aria-current': String(state.selected === e.key),
          onclick: () => select(e.key),
        },
        el('span', { class: 't', text: e.title }),
        e.summary ? el('span', { class: 's', text: e.summary }) : null,
        el('span', { class: 'm' },
          el('span', { text: STATUS[e.status] || KIND[e.kind] }),
          e.date ? el('span', { text: e.date }) : null,
          !state.project ? el('span', { text: e.project }) : null)))
      }
    }
    box.replaceChildren(...nodes)
  }

  function findEntry(key) { return all().find(e => e.key === key) }

  function refButton(project, ev) {
    const [kind] = Object.keys(ev)
    const value = ev[kind]
    if (kind === 'user') return el('span', { class: 'ref user', text: '사용자 확인 ' + value })
    let key = null
    if (kind === 'source') key = project + '/sources/' + value.split('@')[0]
    if (kind === 'decision') key = project + '/decisions/' + (value.endsWith('.md') ? value : value + '.md')
    if (kind === 'knowledge') key = project + '/knowledge/' + (value.endsWith('.md') ? value : value + '.md')
    return el('button', { class: 'ref', text: KIND[kind] + ' ' + value, onclick: () => key && select(key) })
  }

  function stateBadge(e) {
    return el('span', { class: 'state ' + markOf(e), text: STATUS[e.status] || KIND[e.kind] })
  }

  function renderDetail() {
    const pane = $('#detail')
    const e = state.selected && findEntry(state.selected)
    if (!e && state.project === ME) {
      pane.replaceChildren(el('article', {}, el('h2', { text: '사용자 메모리' }),
        el('p', { class: 'overview', text: '저장된 항목 ' + PERSONAL.length + '개. 지금 요청이 우선하고, 충돌하면 프로젝트 > 회사 > 전역 순으로 따릅니다. 고치거나 지우려면 pm me edit/forget.' })))
      return
    }
    if (!e) {
      const ps = projects()
      pane.replaceChildren(el('article', {},
        el('h2', { text: ps.length === 1 ? ps[0].title : '프로젝트 메모리' }),
        el('p', { class: 'overview', text: ps.length === 1 ? ps[0].summary : '왼쪽에서 기록을 고르거나 위에서 검색하세요.' }),
        ps.length === 1 && ps[0].overview ? markdown(ps[0].overview) : null))
      return
    }
    const head = [el('h2', { text: e.title })]
    const facts = el('div', { class: 'facts' }, stateBadge(e))
    const add = (label, value) => value && facts.append(el('span', {}, label + ' ', el('b', { text: String(value) })))
    let body = null
    const refs = el('div', { class: 'refs' })
    if (e.me) {
      const d = e.me.data
      add('범위', scopeText(d)); add('종류', d.kind); add('확인', dateText(d.confirmed)); add('수정', dateText(d.updated))
      add('판번호', d.revision); add('재확인일', dateText(d.review_after)); add('id', e.rel)
      refs.append(el('span', { text: '근거' }), el('span', { class: 'ref user', text: d.source }))
      body = markdown(e.me.body)
    } else if (e.doc) {
      const d = e.doc.data
      add('날짜', dateText(d.date)); add('결정한 사람', d.decided_by); add('갱신', dateText(d.updated))
      add('물어볼 곳', d.ask_to); add('물은 날', dateText(d.asked)); add('해결', dateText(d.resolved))
      add('파일', e.rel)
      const ev = Array.isArray(d.evidence) ? d.evidence : []
      if (ev.length) refs.append(el('span', { text: '근거' }), ...ev.map(x => refButton(e.project, x)))
      for (const [label, v] of [['보충 대상', d.relates_to], ['대체한 결정', d.superseded_by], ['답이 된 결정', d.resolved_by]]) {
        const list = (Array.isArray(v) ? v : v ? [v] : [])
        if (list.length) refs.append(el('span', { text: label }), ...list.map(x => refButton(e.project, { [label === '보충 대상' ? 'knowledge' : 'decision']: x })))
      }
      body = markdown(e.doc.body)
    } else {
      const s = e.source
      if (s.usedBy.length) refs.append(el('span', { text: '이 자료를 근거로 쓰는 문서' }),
        ...s.usedBy.map(rel => el('button', { class: 'ref', text: slug(rel), onclick: () => select(e.project + '/' + rel) })))
      body = el('div', { class: 'body' }, ...s.versions.slice().reverse().map(v => el('section', {},
        el('h3', { text: '버전 ' + v.id }),
        el('p', { text: '원래 이름 ' + v.original_name + ', 받은 날 ' + v.received + (v.note ? ', ' + v.note : '') }),
        el('ul', { class: 'files' }, ...v.files.map(f => el('li', {}, el('a', {
          href: ['..', 'projects', e.project, 'sources', s.name, v.id, ...f.split('/')].map(encodeURIComponent).join('/').replace(/^\.\./, '..'),
          text: f, target: '_blank', rel: 'noopener' })))))))
    }
    pane.replaceChildren(el('article', {}, ...head, facts, refs.childNodes.length ? refs : null, body))
    pane.scrollTop = 0
  }

  function markdown(src) {
    const box = el('div', { class: 'body' })
    box.innerHTML = DOMPurify.sanitize(marked.parse(src || ''))
    return box
  }

  function select(key) {
    state.selected = key
    const e = findEntry(key)
    if (e && state.project && e.project !== state.project) state.project = e.project
    history.replaceState(null, '', '#' + encodeURIComponent(key))
    render()
  }

  function render() { renderTop(); renderChips(); renderList(); renderDetail() }

  $('#project').addEventListener('change', ev => {
    state.project = ev.target.value; state.selected = null
    try { localStorage.setItem('pm.project', state.project) } catch {}
    render()
  })
  $('#q').addEventListener('input', ev => { state.query = ev.target.value; renderList() })
  $('#open').addEventListener('click', () => { state.kind = state.kind === 'open' ? 'all' : 'open'; render() })
  document.addEventListener('keydown', ev => {
    if (ev.key === '/' && document.activeElement !== $('#q')) { ev.preventDefault(); $('#q').focus() }
  })
  const fromHash = decodeURIComponent(location.hash.slice(1))
  if (fromHash && findEntryAny(fromHash)) { state.project = fromHash.split('/')[0]; state.selected = fromHash }
  function findEntryAny(key) { return [...DATA.projects.flatMap(entriesOf), ...personalEntries()].find(e => e.key === key) }
  $('#stamp').textContent = '커밋 ' + (DATA.commit || '없음').slice(0, 9) + ' 기준, ' + new Date(DATA.generatedAt).toLocaleString('ko-KR') + ' 생성'
  render()
})()
`

export function renderViewerHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>프로젝트 메모리</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <h1>프로젝트 메모리</h1>
  <select id="project" aria-label="프로젝트"></select>
  <input id="q" type="search" placeholder="제목·요약·본문 검색 ( / )" aria-label="검색">
  <button id="open" class="open-count" type="button" aria-pressed="false"></button>
  <small id="stamp" style="color:var(--steel)"></small>
</header>
<main class="main">
  <nav class="list" aria-label="기록 목록"><div id="chips" class="chips"></div><div id="entries"></div></nav>
  <section id="detail" class="detail" aria-live="polite"></section>
</main>
<script type="application/json" id="pm-data">${json}</script>
<script>${vendor('marked/lib/marked.umd.js')}</script>
<script>${vendor('dompurify/dist/purify.min.js')}</script>
<script>${APP}</script>
</body>
</html>
`
}

export function viewerPath(root) {
  return join(root, 'viewer', 'index.html')
}

/** 고정 커밋 기준으로 뷰어를 다시 만든다. 경로를 돌려준다. */
export function buildViewer(root) {
  const html = renderViewerHtml(buildViewerData(root, pinHead(root)))
  const path = viewerPath(root)
  atomicWrite(path, Buffer.from(html))
  return path
}

/** 쓰기 명령 뒤에 부른다. 뷰어 실패가 쓰기 결과를 실패로 만들지 않는다. */
export function rebuildViewerQuietly(root) {
  try {
    buildViewer(root)
  } catch (err) {
    process.stderr.write(`pm: 뷰어를 다시 만들지 못했습니다 — ${err.message} (pm view 로 다시 시도)\n`)
  }
}
