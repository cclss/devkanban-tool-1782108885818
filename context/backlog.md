# Backlog

## 2026-08-26 (grain-1: 웹 공개링크·회원가입 기본 locale en)
- `apps/web/src/app/login/page.tsx:21` — `validate(..., t: (key: any) => string)` 의
  `any` 로 인해 `@typescript-eslint/no-explicit-any` lint 경고 발생 (`next lint --max-warnings 0` FAIL).
  선행 grain(`feat(grain-3)`)에서 유입된 pre-existing 이슈이며 본 grain(signer/share context, signup)
  파일 범위 밖. 별도 grain 에서 `t` 콜백 키 타입을 좁혀 해소 필요.
