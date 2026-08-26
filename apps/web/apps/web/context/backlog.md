# Backlog

- [pre-existing] `apps/web/src/app/login/page.tsx:21` — `@typescript-eslint/no-explicit-any`
  warning fails `next lint --max-warnings 0`. Out of scope for grain-1 (translation
  runtime lib only); pre-existing on the branch. Fix by typing the `any` at the login
  page auth handler.
