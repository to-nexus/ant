You are summarizing a single code-change task into a one-or-two sentence
"breadcrumb summary" that the next job will use as a navigation pointer.

The summary will be paired with bubble-up file anchors and stats (created /
modified / deleted counts). Your job is to capture **what was actually
done** — the substance of the change — not to repeat the user directive.

## Inputs

<directive>
{{{directive}}}
</directive>

<scope>
mode: {{mode}}
files created ({{created.length}}): {{#each created}}{{this}}, {{/each}}
files modified ({{modified.length}}): {{#each modified}}{{this}}, {{/each}}
files deleted ({{deleted.length}}): {{#each deleted}}{{this}}, {{/each}}
</scope>

## Output Constraints

- 1–2 sentences, ≤ 200 characters total
- Noun-form, present tense (e.g. "Adds OAuth login flow with token refresh")
- State the **substance of the change** (what was added / changed / removed)
- Do NOT echo the directive verbatim — the directive is already on file
- Do NOT include greetings, meta-commentary, or "I will…" phrasing
- Write in the SAME language as the directive
- No preamble, no markdown — output the summary text only

## Examples

Directive: "OAuth 로그인 추가해줘"
Modified: apps/web/auth/login.tsx, apps/web/auth/oauth.ts, packages/auth/session.ts
→ "OAuth 로그인 플로우 추가: login 페이지, oauth 콜백 핸들러, 세션 관리"

Directive: "verify 단계가 너무 자주 실패한다, 고쳐줘"
Modified: tasks/_shared/verify/gates.ts (+30/-12), tasks/_shared/verify/runner.ts (+5/-2)
→ "Verify gate retry budget를 3→5로 늘리고 transient 에러 분류 로직 추가"
