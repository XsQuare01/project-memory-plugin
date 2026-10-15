// 테스트용 프로젝트 'p' 를 만든다: 개요, 제안 지식, 확정 지식, 결정, 열린 질문, 자료 버전 하나.
import { write, git } from '../helpers.mjs'

export const P = 'projects/p'

export const docs = {
  project: `---
title: 테스트 과제
summary: 테스트용 프로젝트
repos: []
created: 2026-10-14
---
개요 한 줄
`,
  proposed: `---
title: 레일 구조
summary: 레일 노드 구조 해석
type: knowledge
status: proposed
evidence:
  - source: meshes@2026-10-11-aaaaaaaa
updated: 2026-10-14
---
첫 줄
둘째 줄
셋째 줄
`,
  confirmed: `---
title: 레일 메시
summary: 메시를 붙이는 노드
type: knowledge
status: confirmed
evidence:
  - user: 2026-10-14 "맞음"
updated: 2026-10-14
---
확정 본문
`,
  decision: `---
title: K3 잠금
summary: 기존 잠금 부품 재사용
type: decision
status: active
date: 2026-10-07
decided_by: 사용자
---
## 결정
재사용
`,
  question: `---
title: 수동 레일 정지
summary: 수동에서 레일이 멈추나
type: question
status: open
asked: 2026-10-07
ask_to: 협력사
---
`,
}

export function seedProject(root) {
  write(root, `${P}/project.md`, docs.project)
  write(root, `${P}/knowledge/rail.md`, docs.proposed)
  write(root, `${P}/knowledge/mesh.md`, docs.confirmed)
  write(root, `${P}/decisions/2026-10-07-k3.md`, docs.decision)
  write(root, `${P}/questions/manual-stop.md`, docs.question)
  write(root, `${P}/sources/meshes/source.json`, JSON.stringify({ title: '메시', versions: [{ id: '2026-10-11-aaaaaaaa' }] }))
  write(root, `${P}/sources/meshes/2026-10-11-aaaaaaaa/README.md`, '메시 설명\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'seed')
  return root
}
