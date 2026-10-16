# project-memory (Claude Code · Codex 플러그인)

과제 단위 프로젝트 메모리와 사용자 메모리. 새 세션·`/clear`·compact 뒤에도 과제의 이해·결정·열린 질문과 사용자 선호를 이어 준다. 두 도구가 같은 데이터를 읽고 쓴다.

## 설치 — Claude Code

```
/plugin marketplace add <이 폴더 또는 GitHub 저장소>
/plugin install project-memory@project-memory
```

설치할 때 두 위치를 묻는다(나중에 `/plugin configure project-memory@project-memory`):

| 옵션 | 내용 | 비워 두면 |
|---|---|---|
| `project_root` | 과제 기록(git 저장소). 빈 폴더면 첫 기록 때 준비된다 | `~/project-memory` |
| `personal_root` | 사용자 메모리(로컬 폴더 권장) | `~/personal-memory` |

플러그인 이전의 수동 설치가 있으면 걷어 낸다: `node bin/pm.mjs install claude --remove`

## 설치 — Codex

```
codex plugin marketplace add <이 폴더 또는 GitHub 저장소>
codex plugin add project-memory@project-memory
```

- Codex 는 플러그인 훅을 바로 믿지 않는다. Codex 에서 `/hooks` 를 열어 이 플러그인의 훅 두 개(세션 시작·턴 시작)를 검토하고 신뢰해야 동작한다. 훅 정의가 바뀌면 다시 신뢰해야 한다(Codex 문서 기준).
- 저장 위치 옵션이 없다. Claude 플러그인이 남긴 `~/.project-memory/config.json` 의 값을 같이 쓰고, 없으면 기본 위치다. 바꾸려면 그 파일에 `{"projectRoot": "…", "personalRoot": "…"}` 를 적는다.
- 쓰기 명령은 작업 폴더 밖(데이터 위치)에 쓰므로 Codex 샌드박스가 승인을 묻는다.

## 쓰기

| 도구 | 입구 |
|---|---|
| Claude Code | `/project-memory:project` — `link`, `use`, `new`, `status`, `save`, `view`, `me` |
| Codex | `project-memory:project` 스킬(`/skills` 또는 말로 요청) — 하위 명령은 같다 |

규칙: [policy.md](policy.md)

## 구성

| 경로 | 내용 |
|---|---|
| `bin/` | `pm` 명령(두 도구 공통) |
| `bin/vendor/` | 외부 패키지 묶음. 설치본은 npm 없이 돈다 |
| `.claude-plugin/`, `hooks/`, `skills/` | Claude Code 연결부 |
| `.codex-plugin/`, `.agents/plugins/`, `adapters/codex/` | Codex 연결부 |

## 개발

```
npm ci
npm test
claude plugin validate .
```

- 코드를 바꾸면 `.claude-plugin/plugin.json` 과 `.codex-plugin/plugin.json` 의 `version` 을 함께 올린다(설치본은 버전으로 갱신을 알아챈다. 테스트가 두 값이 같은지 본다).
- 외부 패키지 버전을 바꾸면 `npm run vendor` 로 `bin/vendor/` 를 다시 만들어 함께 커밋한다.
