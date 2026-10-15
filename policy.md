# 프로젝트 메모리 기록 규칙

모든 도구(Claude Code, Codex)의 에이전트가 따르는 공통 규칙이다.

## 무엇을 어디에

| 넣는다 | 넣지 않는다 |
|---|---|
| 과제의 도메인 이해, 자료 해석, 좌표·단위 규약 | 미커밋·stash·PR 대기 같은 작업 상태 |
| 결정과 이유, 버린 대안 | 개인 취향 규칙(그건 도구의 사용자 지침에) |
| 열린 질문, 외부 확인 대기 | scratchpad 같은 세션 임시 경로, 그 세션 전용 도구 |
| 사람과 역할 | 절대 경로 — 자료는 `sources/` 상대 경로로 |
| 원본 자료(사본) | 비밀번호·토큰 |
| | 코드를 읽으면 다시 알 수 있는 것(코드 위치·줄 번호) |

- `knowledge/` 주제 하나 = 파일 하나. `decisions/` 결정 하나 = 파일 하나(`YYYY-MM-DD-<요약>.md`). `questions/` 질문 하나 = 파일 하나.
- 모든 문서 머리말에 `title` 과 한 줄 `summary`(120자 이내).

## 언제 쓰나

| 순간 | 무엇을 | 상태 |
|---|---|---|
| 사용자가 설명을 정정하거나 확인해 줄 때 | 해당 문서 수정 (`--confirm "<확인 내용>"`) | confirmed |
| 사용자가 선택지 중 하나를 고를 때 | `decisions/` 새 파일, `decided_by: 사용자` | active |
| 외부 확인이 필요한 질문이 생길 때 | `questions/` 새 파일 | open |
| 새 원본 자료를 받을 때 | `pm add-source` + 그 자료를 설명하는 `knowledge/` | 해석은 proposed |
| 근거를 갖고 알아낸, 코드에 없는 해석 | `knowledge/` **새** proposed 파일 (보충 대상이 있으면 `relates_to`) | proposed — 묻지 않는다 |
| 사용자가 proposed 를 맞다고 할 때 | 확인받은 범위만 confirmed 로 옮기거나 승격. 일부만 확인되면 나머지는 proposed 로 남긴다 | confirmed |
| 세션 마무리(`/clear` 전, 끝 신호) | 이번 세션에서 안 남긴 이해를 훑어 제안 | 제안 |

- proposed 로 남기는 조건(셋 다): 근거(`evidence`)가 있다 · 이후 세션에도 쓸모가 있다 · 기존 기록과 겹치지 않는다.
- confirmed 문서에는 사용자 확인 없이 새 해석을 섞지 않는다. 변경 전이나 후가 confirmed 이면 `--confirm` 이 필요하다(작성·승격·수정·삭제 모두).
- 기록할 때마다 응답에 한 줄로 알린다: `메모리 기록: knowledge/x.md (proposed)`.
- 메모리 쓰기는 메인 세션만 한다. 서브에이전트에게는 읽을 파일 경로만 넘긴다.

## 어떻게 쓰나

정본(`projects/` 아래 파일)을 직접 고치지 않는다. 셸(`sed`, `>`)로도 쓰지 않는다.

```
node <플러그인 폴더>/bin/pm.mjs checkout <프로젝트 상대 경로> [--new | --delete] --agent <도구> --session <세션 ID>
  → 출력된 변경안 파일을 고친다
node <플러그인 폴더>/bin/pm.mjs apply -m "<무엇을 왜>" [--confirm "<사용자 확인 요약>"] --agent <도구> --session <세션 ID>
```

- 충돌(종료 코드 3)이면 `checkout --refresh <경로>` 로 기준을 새로 받고, 상대의 변경을 살려 다시 반영한다.
- 자료는 `add-source <원본 경로> --as <자료 이름>`. 원본은 지우지 않는다.
- 근거 표기: `source: <자료>@<버전 ID>`, `decision: <파일 이름>`, `knowledge: <파일 이름>`, `user: <날짜> "<확인 내용>"`.

## 사용자 메모리 (`pm me`)

사용자에 대한 정보는 과제가 아니라 사용자 메모리(플러그인 옵션 `personal_root`, 기본 `~/personal-memory`, 로컬 전용 권장)에 둔다.

- 기록: 사용자가 직접 말한 **지속** 선호·사실만. "이번엔 …", 에이전트의 짐작은 기록하지 않는다(반복해서 도움이 되면 "앞으로도 그렇게 할까요?" 로 확인 후).
- `text` 는 근거보다 강하게 쓰지 않는다. 원문에 없는 요구를 더하거나 범위를 넓히지 않는다.
- 범위: `global` · `company:<이름>` · `project:<이름>`. 애매하면 한 번 묻는다. `--core` 는 모든 세션에 넣을 소수의 global 선호만(합계 600자).
- 충돌: 현재 요청 → 프로젝트 → 회사 → global. 한 번의 예외로 선호를 덮어쓰지 않는다.
- 반드시 지킬 제약("절대 …하지 마")은 사용자 메모리가 아니라 지침 파일에 넣자고 제안한다.
- 동료는 업무 역할·관계만. 민감 정보·비밀은 넣지 않는다.
- 사용자 요청 없이 PR·공유 문서·작업 요약에 넣지 않는다.
- 수정은 `pm me edit <id> --base <판번호>`(확인일 유지), 사용자가 확인·정정했으면 `pm me confirm`. "잊어" 는 `pm me forget <id>`.
- 기록하면 한 줄로 알린다: `사용자 메모리 기록: <id> (<범위>)`.

## 머리말 형식

```yaml
# knowledge/*.md
title: 예시 메시
summary: 메시 3종을 어느 노드에 붙이나, z-up · 단위 m
type: knowledge
status: proposed            # proposed | confirmed
relates_to: []
evidence:
  - source: sample-meshes@2026-10-11-3f9a1c2e
updated: 2026-10-14

# decisions/*.md — 본문: 결정 / 이유 / 버린 대안
title: …
summary: …
type: decision
status: active              # active | superseded
date: 2026-10-07
decided_by: 사용자
superseded_by:

# questions/*.md
title: …
summary: …
type: question
status: open                # open | resolved
asked: 2026-10-07
ask_to: 협력사 · PLC
resolved:
resolved_by:
```
