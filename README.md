# project-memory (Claude Code 플러그인)

과제 단위 프로젝트 메모리와 사용자 메모리. 새 세션·`/clear`·`/compact` 뒤에도 과제의 이해·결정·열린 질문과 사용자 선호를 이어 준다.

## 설치

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

## 쓰기

`/project-memory:project` — `link <과제>`, `use <과제>`, `new`, `status`, `save`, `view`, `me`.

규칙: [policy.md](policy.md)

## 개발

```
npm ci
npm test
claude plugin validate .
```

코드를 바꾸면 `.claude-plugin/plugin.json` 의 `version` 을 올린다(설치본은 버전으로 갱신을 알아챈다).
