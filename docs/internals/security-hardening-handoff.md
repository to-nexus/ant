# ANT 보안성 검수 — 전수조사 결과 & 단계별 실행/핸드오프 SSOT

> **이 문서는 단일 나침반(SSOT)이다.** 새 탭에서 작업 재개 시 §0(대시보드)·§1(잠긴 결정)·해당 Phase 섹션만 읽으면 자기완결적으로 진행 가능하다. 각 Phase 완료 후 반드시 §0 대시보드와 §9 진행로그를 갱신한다.

---

## §0. 진행 대시보드 (작업 후 갱신)

상태: ⬜ 미착수 / 🔄 진행중 / ✅ 완료 / ⏭️ 스킵(사유)

| Phase | repo | 내용 | sev | 상태 |
|---|---|---|---|---|
| P0 | both | 핸드오프 doc 승격 + 보안 posture baseline + 의존성 audit 정책 | — | ✅ |
| **P1** | ant | **Proxy-family 인가 (IDE O11 / Preview O13 / SA토큰 O12)** | **CRIT** | ✅ |
| P2 | ant | 컨테이너 하드닝 (Dockerfile.ide digest / ant-ui cat .env / .dockerignore) | H/M | ✅ |
| P3 | ant | 의존성 취약점 (런타임 우선 bump / dev-only audit-ignore) | M | ✅ |
| P4 | ant | 앱-레이어 (암호화키 fail-fast / http_request SSRF / K8s securityContext / 로컬모드 warn) | M | ⬜ |
| P5 | ant-cloud | Actions SHA 핀 + workflow permissions + SECURITY.md | H/M | ⬜ |
| P6 | ant-cloud | deploy ticket 가드 + auth 디버그 로깅 | M | ⬜ |
| P7 | ant-cloud | 히스토리 시크릿 scrub 검증 + tenant isolation 검증 | H | ⬜ |
| H | infra | DevOps 핸드오프 항목 전달 (코드범위 밖) | — | ⬜ |

**권장 순서**: P0 → **P1(최우선)** → P2 → P3 → P4 → P5 → P6 → P7 → H. P1만 동작-변경 위험이 있으니 단독 PR 권장. P2~P4는 독립적이라 순서 무관.

---

## §1. 잠긴 결정 (사용자 승인)

1. **접근 방식**: 도구 증상 반응이 아니라 **보안검토 먼저 → 설계 기준 위에서 remediation**. 오버엔지니어링 배제, 목표는 검수 통과.
2. **순서**: `ant`(상류 OSS) → `ant-cloud`(하류). 단 P1은 cloud-multi-tenant 영향이 커 최우선.
3. **의존성**: 실용적 — 런타임/프로덕션 영향 우선 bump, dev-only는 안전 bump 시도 후 깨지면 audit-ignore + 문서화.
4. **Actions 핀**: 서드파티/@master만 commit SHA. 1st-party(`actions/*`/`pnpm/*`/`aws-actions/*`)는 `@vN` 유지.
5. **수정 범위**: 도구-탐지 항목 + 저비용 앱픽스 + (검토로 발견된) 구조적 인가 결함. 방어심화는 저비용만.
6. **Proxy 인가 패턴**: deploy proxy의 기존 소유권 체크를 **SSOT로 차용**(재구현 금지).
7. **커밋**: ant=main 직접(자동 브랜치 금지), 영어 메시지, task 파일만 명시 add. push/배포는 사용자 확인 후.

### Open Question (P1 착수 전/중 확정)
- **Preview 공유 의미론**: ✅ **owner-only 확정**(2026-06-30 사용자 승인). visibility 개념 없이 cloud-mode 에서 세션 org/sub 가 urlKey 앞 2 세그먼트와 일치할 때만 통과, 불일치 403(HTTP)/destroy(WS). 로컬모드(jwt 미주입) skip 유지.

---

## §2. Context (왜 이 작업인가)

회사 devsecops가 gitleaks/Trivy/Checkov/actionlint/pnpm audit/SAST로 ANT를 검수 예정. ANT는 보안을 1급 고려한 적이 없어, 증상만 반응 패치하면 재작업·잘못된 설계가 굳는다. 따라서 (1) 보안 baseline 명문화로 기준 수립 → (2) 검증된 결함 단계 해소.

공급 구조: `ant`(공개 OSS, 로컬모드 단독 동작 가능) → `ant-cloud`(private, `ant`를 submodule SHA 핀 + `packages/cloud` overlay: billing/OAuth/org). OSS는 "공개+submodule 소비" 관점, ant-cloud는 "회사 클라우드 서비스" 관점으로 검수.

본 SSOT는 3개 병렬 보안 스윕(app-layer / infra-supply-chain / cloud) + 직접 코드검증으로 작성. 검증으로 2건 강등(아래 §3), proxy-family 인가 결함 2건 추가발견(P1).

경로: ant=`/Users/probe/dev/ant`, ant-cloud=`/Users/probe/dev/ant-cloud`(ant submodule은 `ant-cloud/ant/`).

---

## §3. 검증으로 강등된 항목 (작업 없음)

- **"tracked .env with real keys"(CRITICAL 보고됨)** → **결함 아님(단, 보고서 서술 정정).** 시크릿 포함 `.env` git-tracked 0건. `packages/ant-cli/.env`는 gitignore된 로컬 파일. **실제 tracked env는 placeholder `.env.example.*`가 아니라 실파일** `packages/ant-ui/.env.{development,production}` **+** `packages/ant-site/.env.{development,production}` 4개이며(ant-site 포함 — 1차 강등 서술에서 누락됐던 부분), 내용은 전부 클라이언트 번들에 baked되는 공개 빌드타임 변수(`VITE_*` / `NEXT_PUBLIC_*`)와 공개 호스트명(`ant-server.cross.nexus`, `ant-server.crosstoken.io`)뿐 — 시크릿 0. → 결함 아님 결론 유지. 로컬 개발키 rotation은 사용자 housekeeping(1차에 Anthropic/OpenAI 키 revoke 완료).
- **CORS `*`(`ANT_CORS_ORIGINS=*`)** → opt-in OFF 기본 + 코드 주석 의도 명시([corsConfig.ts](packages/ant-cli/src/periphery/adapters/http/middleware/corsConfig.ts)). 런타임-config 위험이지 스캐너 결함 아님 → posture에 "prod에서 `*` 금지" 한 줄.

---

## §4. Proxy-family 멀티테넌트 인가 분석 (P1 근거 — 핵심 발견)

세 proxy surface가 동일 `baseProxy` 상속, key arity·인가 성숙도 제각각. urlKey는 `individual:email:project:feature`로 **열거 가능**(랜덤 capability 아님) → obscurity 보호 없음.

| surface | mount | arity | 현재 인가 | 결론 |
|---|---|---|---|---|
| `/ide/` HTTP+WS (ant-api) | [ServerConfigurator.ts:133](packages/ant-cli/src/periphery/adapters/http/express/config/ServerConfigurator.ts#L133) + [ExpressServerAdapter.ts:277(WS)](packages/ant-cli/src/periphery/adapters/http/express/ExpressServerAdapter.ts#L277) | 4-part `tenant:user:project:feature` | JWT 유효성만(HTTP·WS 둘 다 `verify` 후 payload 폐기), **소유권 미대조** | ❌ **O11 CRIT** |
| `/preview/` **HTTP** (ant-preview) | [PreviewServer.ts:522](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L522) | 4/5-part (+serviceName) | **인증 전무**(proxy가 JWT 미들웨어 558·body parser 549·cookie-parser 546보다 먼저 mount + `jwtService` 미주입 → proxy 종결로 auth 영원히 미도달) | ❌ **O13 CRIT (최악)** |
| `/preview/` **WS** (ant-preview) | [PreviewServer.ts:1159-1168](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L1159-L1168) | 4/5-part | cloud-mode에서 JWT **유효성은 검사**(`verify` 후 payload 폐기) — IDE/O11과 동급, **소유권 미대조**(HTTP와 달리 인증 전무는 아님) | ❌ **O13-WS (O11 동급)** |
| `/deploy/` HTTP+WS (ant-preview) | [PreviewServer.ts:536](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L536), [deployProxy.ts:52-73](packages/ant-cli/src/periphery/adapters/http/middleware/deployProxy.ts#L52-L73), [WS gate 1130-1143](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L1130-L1143) | 4/5-part (+package) | `visibility==='private'`시 `payload.org===tenantId && payload.sub===userId` (HTTP·WS 대칭), public 의도적 개방 | ✅ **레퍼런스** |

위협: 로그인 사용자(IDE / Preview-WS)가 유효 JWT만 들고 urlKey 추측으로 타인 자원 접근, 또는 **완전 비인증자**(Preview-HTTP)가 토큰 없이 타인 프리뷰 앱 접근. 즉 Preview는 두 결을 가짐 — HTTP는 인증 전무(최악), WS는 인증은 되나 소유권 미대조(O11 동급). 둘 다 P1 remediation(소유권 게이트 + Preview-HTTP는 jwtService 주입)이 함께 닫는다. SAST가 놓치기 쉬운 로직 결함 → 검토-우선의 정당성.

격리 다른 축(IDE pod): ✅ **파일시스템 견고**(EFS subPath + `assertWorkspacePathInBase`/`stripBase` base-밖 throw, 작업 없음). ⚠️ SA토큰(O12)·securityContext(O8) pod 하드닝. ↗️ NetworkPolicy=cloud-infra IaC(DevOps).

---

## §5. Phase 상세 (각 자기완결적 — 새 탭 진입 가능)

각 Phase: **[진입]** 먼저 읽을 것 → **[범위/파일]** → **[단계]** → **[검증]** → **[완료조건]**.

---

### P0 — 핸드오프 승격 + 보안 baseline + 의존성 정책 (both)

**[진입]** §1 결정, §2 Context.
**[범위/파일]**
1. 이 plan 파일을 **git-tracked 핸드오프 doc**로 승격: `docs/internals/security-hardening-handoff.md` 로 복사(이후 §0/§9 갱신은 양쪽 또는 tracked 쪽에서). CLAUDE.md docs 색인 규칙 따라 필요 시 한 줄 추가.
2. `docs/internals/security-posture.md` 신설 — 5축 SSOT:
   - 시크릿(.env gitignore + gitleaks CI history scan + ANT_ENCRYPTION_KEY AES-256-GCM)
   - 의존성 정책(런타임 우선 bump / dev-only audit-ignore 근거 / pnpm `allowBuilds` 화이트리스트)
   - CI 스캐닝 게이트(gitleaks dir+history; 향후 도구 자리)
   - 컨테이너/K8s 하드닝 표준(non-root, digest 핀, securityContext, automountSAToken:false)
   - auth/tenant 모델(JWT 전역 + proxy 소유권 게이트 + org/user 스코프; 로컬모드=단일개발자 가정; O10/O9 위협모델; CORS `*` 금지)
3. ant-cloud `SECURITY.md` 신설(C6, OSS `SECURITY.md` 톤).
4. 의존성 audit-ignore 근거 기록 위치 확정(posture 또는 overrides 주석).

**[검증]** 문서 빌드/링크 확인. tracked 핸드오프가 새 탭에서 읽혀 §0 대시보드로 재개 가능.
**[완료조건]** posture/SECURITY/핸드오프 3종 존재, §0 P0=✅.

---

### P1 — Proxy-family 인가 (ant, CRITICAL, 단독 PR) ⭐

**[진입]** §4 전체 + deploy proxy를 레퍼런스로 정독([deployProxy.ts:52-73,125,165](packages/ant-cli/src/periphery/adapters/http/middleware/deployProxy.ts#L52-L73)).
**[범위/파일]**
- 신규 SSOT 헬퍼(예: `periphery/adapters/http/middleware/proxyOwnership.ts`): `assertProxyOwnership(payload, parts) → payload.org===parts.tenantId && payload.sub===parts.userId`. owner는 **앞 2 segment**에서 파싱(4/5-part 무관).
- IDE HTTP guard: [ServerConfigurator.ts:133-154](packages/ant-cli/src/periphery/adapters/http/express/config/ServerConfigurator.ts#L133-L154) — JWT verify 후 serverKey 파싱(`parseIDEKey`) + 헬퍼 호출, 불일치 403.
- IDE WS guard: [ExpressServerAdapter.ts:277-300](packages/ant-cli/src/periphery/adapters/http/express/ExpressServerAdapter.ts#L277-L300) — verify 결과 payload를 url serverKey와 대조(현재 payload 폐기 중), 불일치 close.
- Preview HTTP: [PreviewServer.ts:522](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L522) — 현재 **인증 전무**이므로 preview proxy에 `jwtService` 주입(신규) + 소유권 게이트(deploy식). 기본 owner-only(§Open Question).
- Preview WS: [PreviewServer.ts:1159-1168](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L1159-L1168) — 현재 cloud-mode JWT **유효성 검사는 이미 있음**(payload 폐기 중). 여기에 소유권 대조(`payload.org===tenantId && payload.sub===userId`)만 추가하면 됨 — deploy WS 게이트([1130-1143](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts#L1130-L1143))가 그대로 레퍼런스.

**[단계]** ① 헬퍼+테스트 → ② IDE HTTP/WS 적용 → ③ Preview HTTP/WS 적용 → ④ deploy 회귀 무손상 확인 → ⑤ 로컬모드(jwt/authService undefined) skip 유지 확인.
**[검증]**
- vitest: IDE·Preview 각각 타 테넌트 key→403/destroy, 본인→통과(HTTP+WS). deploy public 개방/private 게이트 회귀 없음.
- cloud-mode boot 스모크: `/ide/{본인}`·`/preview/{본인}` 통과, `{타인}` 거부.
- `cd /Users/probe/dev/ant && pnpm build`(테스트 게이트) green.
**[완료조건]** 4 경로(IDE/Preview × HTTP/WS) 소유권 강제 + 회귀 green. §0 P1=✅.

---

### P2 — 컨테이너 하드닝 (ant)

**[진입]** §1 결정 3·5.
**[범위/파일/단계]**
- O3 [Dockerfile.ide](packages/ant-cli/Dockerfile.ide): `FROM gitpod/openvscode-server:latest` → `@sha256:<digest>` 핀(현재 안정 태그 digest 확인 후).
- O4 [ant-ui Dockerfile](packages/ant-ui/Dockerfile): 빌드 스텝의 `cat ./packages/ant-ui/.env.*` 제거(복사만 유지).
- O5 `.dockerignore` 신설(cli/ui): `.git`, `node_modules`, `.env*`, `tests`, `dist` 등 제외.
**[검증]** `docker build` cli/ui/ide 성공 + ripgrep `test -x` 게이트 통과(CLAUDE.md). 빌드로그에 env 미노출.
**[완료조건]** 3 항목 반영 + 이미지 빌드 green. §0 P2=✅.

---

### P3 — 의존성 취약점 (ant)

**[진입]** §1 결정 3, posture 의존성 정책.
**[범위/단계]**
- `pnpm audit`로 현황 캡처.
- O1 런타임/프로덕션 영향(js-yaml, body-parser, qs, mermaid>DOMPurify) 우선 bump 또는 pnpm `overrides`.
- O2 dev-only(vite/vitest/esbuild/rollup) 안전 bump 시도 → 깨지면 audit-ignore + posture 근거.
**[검증]** `pnpm build`(테스트 게이트) green. `pnpm audit` 런타임 취약점 0(수용분만 잔존, 근거 문서화).
**[완료조건]** 런타임 취약점 해소 + dev-only 처리 결정 기록. §0 P3=✅.

**[현황 캡처 — 2026-06-30 `pnpm audit`]** 총 37건 (critical 2 / high 5 / moderate 25 / low 5). 각 top-level 패키지를 dependencies(런타임) vs devDependencies(빌드/테스트)로 분류:

- **critical/high 5건은 전부 dev-only** — 프로덕션 이미지/브라우저 번들에 미포함:
  - `vitest`(CRIT, UI server arbitrary file read), `concurrently`→`shell-quote`(CRIT), `rollup`(HIGH), `vite`(HIGH×) — 모두 test/build 툴체인. → O2 트랙: 안전 bump 시도, 깨지면 audit-ignore + 본 근거.
- **런타임 취약점은 전부 moderate 이하** (O1 트랙):

  | 패키지 | 선언 위치 | 현재→패치 | 위협 | 처리 |
  |---|---|---|---|---|
  | `js-yaml` | ant-cli dep `^4.1.1` | →4.1.2 | merge-key DoS | direct bump (patch) |
  | `follow-redirects` | http-proxy-middleware 경유 | →1.15.12 | **auth 헤더 cross-domain 누출 (P1 프록시 인접 — 우선)** | `overrides` |
  | `body-parser` | express 경유 | →2.2.1 | urlencoded DoS | `overrides` |
  | `qs` | express / rate-limit 경유 | →6.15.2 | stringify/arrayLimit DoS (3 advisory) | `overrides` |
  | `mermaid` | ant-ui dep `^11.14.0` | →11.14.1 | classDef/config XSS + gantt DoS (FE) | direct bump (patch) |
  | `dompurify` | mermaid 경유 | →3.4.11 | IN_PLACE/shadow-root XSS 다수 (FE) | mermaid bump 후 잔존 시 `overrides` |
  | `mdast-util-to-hast` | react-markdown/rehype-raw 경유 | →13.2.1 | unsanitized class attr XSS (FE) | `overrides` |
  | `uuid` | ant-cli dep `^11.1.0` (+langgraph/bullmq/dockerode 경유) | →11.1.1 | buf bounds (저익스플로잇) | bump + `overrides` |
  | `brace-expansion` | @google/genai 등 경유 | →2.0.3 | zero-step DoS | `overrides` |
  | `ip-address` | express-rate-limit 경유 | →10.1.1 | Address6 HTML XSS (미사용 경로) | `overrides` |
  | `yaml` | ant-ui dep `^2.8.2` | →2.8.3 | nested YAML 스택오버플로 DoS | direct bump (patch) |

  핵심: 런타임 취약점은 전부 patch-level bump 또는 transitive `overrides` 로 닫히며 major-bump breaking 위험 없음. `@ant/shared` 런타임 무변. **→ 적용 완료(아래 §9 P3 완료 엔트리 참조).**

---

### P4 — 앱-레이어 저비용 픽스 (ant)

**[진입]** §1 결정 5.
**[범위/파일/단계]**
- O6 [CredentialsStore.ts:205-226](packages/ant-cli/src/utils/userConfig/CredentialsStore.ts#L205-L226): `ANT_ENCRYPTION_KEY` set인데 hex/길이 invalid면 **throw**(파일/임의키 fallback은 env 미지정 시만).
- O7 [httpProbe.ts:56-72](packages/ant-cli/src/agents/common/tool/handlers/httpProbe.ts#L56-L72): 절대 URL은 loopback + 등록 프리뷰 호스트만 허용, 메타데이터 IP 등 reject. 상대 URL 불변.
- O8 [KubernetesIDEOrchestrator.createPodSpec](packages/ant-cli/src/infrastructure/ide/KubernetesIDEOrchestrator.ts#L377-L444): pod+container `securityContext`(`runAsNonRoot:true`/`runAsUser:1000`/`allowPrivilegeEscalation:false`/`capabilities.drop:['ALL']`). + O12 `automountServiceAccountToken:false`(P1에서 안 했으면 여기서).
- O9 [userContext.ts:30-124](packages/ant-cli/src/periphery/adapters/http/routes/helpers/userContext.ts#L30-L124): 멀티-org/user 감지 시 1회 `logger.warn`. 동작 불변 + posture 명시.
**[검증]** vitest: httpProbe SSRF 차단 + CredentialsStore throw. createPodSpec 단위테스트로 securityContext 필드 검증. `pnpm build` green.
**[완료조건]** 4 항목 반영 + 테스트. §0 P4=✅.

---

### P5 — ant-cloud Actions 핀 + permissions + SECURITY.md

**[진입]** §1 결정 4. 작업 디렉토리 `/Users/probe/dev/ant-cloud`.
**[범위/파일/단계]**
- C1 [.github/workflows/*](../../../ant-cloud/.github/workflows): `to-nexus/cross-hub-workflows/...@master` **총 9곳 / 3개 파일**(전수) — **deploy.yml ×7**(L56 security-scan-v2 + L253/271/297/412/434/464 ant-cloud.yml), **build-ide-image.yml:29**(security-scan-v2), **pr-security-check.yml:13**(security-scan-v2) + `peter-evans/create-pull-request@v6`(update-submodule.yml:95) → 전부 commit SHA 핀(주석에 버전 병기). ⚠️ 1차 서술이 deploy.yml만 보고 build-ide-image.yml·pr-security-check.yml 2개 파일을 누락했으니 실행 시 3개 파일 모두 sweep. `security-scan-v2.yml`/`ant-cloud.yml`은 외부 reusable workflow 이름이지 로컬 파일명이 아님(로컬 워크플로 파일 = build-ide-image / deploy / pr-security-check / update-submodule). `actions/*`·`pnpm/*`·`aws-actions/*`는 `@vN` 유지.
- C5 4개 워크플로(`build-ide-image`/`deploy`/`pr-security-check`/`update-submodule`) `permissions:` 블록 점검(현재 4개 모두 블록 존재) → job별 read-only 기본 + 필요한 write만(contents/pull-requests/id-token). deploy.yml:46은 이미 `id-token:write`/`contents:read`/`actions:write`.
- C6 `SECURITY.md`(P0와 합쳐도 됨).
**[검증]** `actionlint`(있으면) green. 워크플로 syntax 유효. 핀 SHA가 실제 존재 ref인지 확인.
**[완료조건]** 서드파티/@master 전부 SHA + permissions 최소화 + SECURITY.md. §0 P5=✅.

---

### P6 — ant-cloud deploy 가드 + auth 디버그 로깅

**[진입]** §1.
**[범위/파일/단계]**
- C3 [deploy.yml:31-35](../../../ant-cloud/.github/workflows/deploy.yml): `environment==prod && ticket_id==''`이면 실패하는 가드 step. required-reviewers는 운영문서 권고(코드 외).
- C4 [auth.routes.ts:440-445,737-743](../../../ant-cloud/packages/cloud/src/routes/auth.routes.ts): `ANT_AUTH_DEBUG`를 prod(`NODE_ENV==production` 또는 `ANT_SERVER_MODE==cloud`)에서 강제 무력화 OR origin/host/xf* redact.
**[검증]** typecheck/test green. ticket 누락 시 prod deploy 실패(워크플로 dry/`act`). prod에서 디버그 로그 미출력 단위확인.
**[완료조건]** 2 항목 반영. §0 P6=✅.

---

### P7 — ant-cloud 히스토리 scrub 검증 + tenant isolation 검증

**[진입]** §1, memory `reference_gitleaks_history_purge_2026-06`.
**[범위/단계]**
- C2 `gitleaks detect --no-banner`(전 히스토리)로 ant-cloud **고유 커밋**(submodule 제외) 실키 확인. 잔존 시 git-filter-repo purge + force-push + rotation(1차 ant 절차 동일). 없으면 "clean" 기록 후 종료.
- C8 [WorkspacePathResolver.ts](../../../ant-cloud/ant/packages/ant-cli/src/core/config/WorkspacePathResolver.ts)가 org+user 둘 다로 경로 스코프하는지 코드+테스트 추적. JWT org 위조 회귀테스트 1건. 정상이면 테스트만 추가, 깨졌으면 별도 보고 후 수정(추측 금지). ⚠️ **스코프 주의**: 이 파일은 `ant-cloud/ant/` 서브모듈 안 = **OSS `ant` 공유 코드**(cloud overlay 아님). 따라서 실제 코드 수정·회귀테스트의 home repo는 **ant**(P1 인접 영역)이며, ant-cloud는 submodule SHA bump로만 반영된다. P7에 둔 건 "tenant isolation 검증"이라는 주제 묶음 때문이지 수정 위치가 ant-cloud라는 뜻이 아니다.
**[검증]** gitleaks history green(또는 scrub 후 green). tenant 회귀테스트 통과.
**[완료조건]** 히스토리 clean 확정 + tenant 스코프 검증/테스트. §0 P7=✅.

---

### H — DevOps 핸드오프 (코드범위 밖, cloud-infra IaC)

전달 항목(작업 아님, 명시 전달): IDE pod **NetworkPolicy**(셸 egress 차단: Redis/DB/메타데이터 169.254.169.254/타 pod), prod **Environment required-reviewers**, OAuth secret 파일마운트 전환 검토(C7), RBAC/PodSecurity 정책. §0 H=✅(전달 완료 시).

---

## §6. 수용/문서화 (작업 안 함, posture 근거 기록)

O10 run_command 체이닝(allowlist bounded + 의도된 `ANT_UNSAFE_*` 탈출구), C7 OAuth secret env-var(K8s 표준), CORS `*`(opt-in OFF), docker-compose root+docker.sock(로컬 dev 전용/prod non-root), ant submodule SHA 핀(이미 정상).

---

## §7. 전역 검증 (전 Phase 후 1회)

- ant: `pnpm build` green, `pnpm audit`(런타임 0/수용분 문서화), `gitleaks dir .`+history green.
- ant-cloud: typecheck/test green, `gitleaks detect` history green, `actionlint` green.
- 가능 시 회사 devsecops 도구셋(Trivy/Checkov/gitleaks/actionlint/pnpm-audit) 로컬 리허설 1회.

## §8. 작업 규약

ant 커밋=main 직접(자동 브랜치 금지, 영어 메시지, task 파일만 add). `@ant/shared` 런타임 변경 시 `pnpm --filter @ant/shared build`. P1은 단독 PR/커밋 권장. push/배포는 사용자 확인 후. 큰 변경 전 승인.

## §9. 진행 로그 (작업마다 한 줄 append)

- (예) 2026-06-30 P0 시작 — 핸드오프 doc 승격 …
- 2026-06-30 **P0 완료** — (1) plan→`docs/internals/security-hardening-handoff.md` git-tracked 승격, (2) `docs/internals/security-posture.md` 5축 SSOT 신설(secrets/deps/CI/container-k8s/auth-tenant), (3) `ant-cloud/SECURITY.md` 신설(멀티테넌트 톤), (4) 의존성 audit-ignore 근거 위치 확정 = posture Axis 2 narrative + `pnpm-workspace.yaml` overrides 인라인 주석, (5) `docs/internals/README.md` 에 Security 섹션 색인 추가. ant 기존 `SECURITY.md` 는 그대로(중복 신설 안 함). 커밋/푸시 미실행(사용자 확인 대기). 다음=P1(Proxy 인가, CRIT, 단독 PR).
- 2026-06-30 **P1 완료** — Open Question=owner-only 확정(사용자 승인). (1) 신규 SSOT 헬퍼 `periphery/adapters/http/middleware/proxyOwnership.ts` — `assertProxyOwnership(payload, {tenantId,userId})` 순수 비교 + `authorizeProxyToken(token, jwt, owner)`(local skip/verify/compare). owner=urlKey 앞 2 세그먼트(4/5-part 무관). (2) **IDE HTTP** [ServerConfigurator.ts](packages/ant-cli/src/periphery/adapters/http/express/config/ServerConfigurator.ts) verify 후 `parseIDEKey`+소유권 대조, 불일치 403(파싱 불가 key 는 기존대로 통과). (3) **IDE WS** [ExpressServerAdapter.ts](packages/ant-cli/src/periphery/adapters/http/express/ExpressServerAdapter.ts) payload 캡처+serverKey 파싱+대조, 불일치 403 close. (4) **Preview HTTP** [previewProxy.ts](packages/ant-cli/src/periphery/adapters/http/middleware/previewProxy.ts) 에 `jwtService`/`cookieName` 주입(인증 전무→owner-only), main+fallback(Referer/cookie) 양 경로 게이트, 불일치 403. [PreviewServer.ts:522](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts) 에서 `createJwtServiceFromEnv()` 주입. (5) **Preview WS** [PreviewServer.ts:1162](packages/ant-cli/src/infrastructure/preview/PreviewServer.ts) payload 캡처+소유권 대조 추가, 불일치 destroy. (6) **deploy 수렴**: HTTP `isAuthorizedForPrivateDeploy` + WS 게이트의 비교 라인을 `assertProxyOwnership` 호출로 교체(동작 무변). 로컬모드(jwt undefined)는 4 경로 모두 skip 유지. 테스트: 신규 `tests/http/proxyOwnership.test.ts`(9) + `tests/preview/previewOwnershipGate.test.ts`(5), 회귀 `tests/{http,preview,deploy,ide,auth,cloud-ide}` 489 passed, `pnpm build`(test gate) green, tsc clean. **미해결**: O12 `automountServiceAccountToken:false` 는 P1 옵션이었으나 미적용 → P4 에서 처리. 다음=P2.
- 2026-06-30 **P0/P1 커밋 완료(main 직접, push 미실행)** — 권장 분리대로 2 커밋: (1) `269dce6a` `docs(security): ...` = P0 docs 3종(README+posture+핸드오프). (2) `a1021b96` `fix(security): enforce owner-only authorization on all proxy paths` = P1 코드 6 + 테스트 2. **커밋 제외(보안작업 무관)**: `.claude/settings.json`(세션 permission allowlist), `docs/internals/ant.code-workspace`(로컬 VSCode 설정) — 둘 다 작업트리에 의도적 잔존. `ant-cloud/SECURITY.md`(P0)는 별도 레포라 ant-cloud 에서 별도 커밋 필요(미실행). push 는 사용자 확인 대기. 다음=P2.
- 2026-06-30 **P2 완료(미커밋)** — 컨테이너 하드닝 3종. (O3) [Dockerfile.ide](packages/ant-cli/Dockerfile.ide) `FROM gitpod/openvscode-server:latest` → `latest@sha256:5e7b8750749f282940a799ed59ccd02fac698ef6744f9113ac01c0ef8e76485e` (멀티아크 인덱스 digest, Docker Hub registry API 로 resolve — `docker manifest inspect` 데몬 불요). re-pin 절차 주석 동봉. (O4) [ant-ui Dockerfile](packages/ant-ui/Dockerfile) 빌드 스텝의 `echo "Environment variables:" && cat ./packages/ant-ui/.env.*` 제거 (빌드로그 env 내용 누출 차단); dev→prod `cp` 동작과 not-found warn 은 보존. (O5) 루트 [.dockerignore](.dockerignore) 신설 — 빌드 컨텍스트가 cli/ui/ide 모두 모노레포 루트라 단일 파일이 전부 커버. `.git`/`**/node_modules`/`**/dist`/`**/tests`/`**/.vite`/`**/coverage` + **시크릿 규칙은 .gitignore 미러**(`**/.env`·`**/*.local` 제외하되 `!**/.env.example.local` negation 으로 tracked 예시 유지). 핵심: `packages/ant-cli/.env`(실 백엔드 시크릿) 컨텍스트 진입 차단, ant-ui/ant-site 빌드가 의존하는 공개 `.env.production`/`.env.development`(VITE_ 공개 var) 는 유지. **검증**: O4 셸 구문 `sh -n` OK; .dockerignore env 시맨틱 7-case 시뮬레이션 ALL OK (cli/.env 제외·ui/.env.production 유지·development.local 제외 등); ant-ui `legacy-sweep.mjs`=`../src/` 만 스캔이라 `tests` 제외 무해 확인. ⚠️ **docker build 실증 미실행** — 로컬 docker 데몬 down. O3=FROM 라인만 / O4=동작 보존 / O5=정적 검증 완료라 저위험이나, 데몬 가용 시 `docker build` cli/ui/ide green + ripgrep `test -x` 게이트 재확인 권장. P2 커밋: `898621b3` (핸드오프 doc 갱신 동봉). 다음=P3.
- 2026-06-30 **P3 검토 단계 완료(🔄 진행중, 미적용)** — `pnpm audit` 현황 캡처 + 런타임/dev-only 분류 (상세 표는 §5 P3 [현황 캡처]). 총 37건(crit 2/high 5/mod 25/low 5). 핵심 결론: **critical/high 5건 전부 dev-only**(vitest/concurrently>shell-quote/rollup/vite — 프로덕션 미포함) → O2 audit-ignore 후보. **런타임 취약점 전부 moderate 이하**, 전건 patch-level bump 또는 transitive `overrides` 로 closeable (major-breaking 위험 없음). 우선순위 1위 = `follow-redirects`→1.15.12 (http-proxy-middleware 경유, auth 헤더 cross-domain 누출 — P1 프록시 인접). 사용자 지시(검토부터)에 따라 **실제 bump/overrides 미적용** — 다음 턴에서 O1(런타임 bump+overrides) → O2(dev-only) → `pnpm build` 게이트 + `pnpm audit` 재확인 순으로 적용 예정.
- 2026-06-30 **P3 완료(미커밋)** — 사용자 결정=직접 bump+overrides 혼합. **O1(런타임)**: 직접 bump = [ant-cli/package.json](packages/ant-cli/package.json) `js-yaml ^4.1.1→^4.1.2`·`uuid ^11.1.0→^11.1.1`, [ant-ui/package.json](packages/ant-ui/package.json) `mermaid ^11.14.0→^11.14.1`·`yaml ^2.8.2→^2.8.3`. transitive `overrides`([pnpm-workspace.yaml](pnpm-workspace.yaml), pnpm11 은 overrides 를 여기서만 인식) = `follow-redirects ^1.15.12`(프록시 인접 auth 누출, 우선)·`body-parser ^2.2.1`·`qs ^6.15.2`·`mdast-util-to-hast ^13.2.1`·`dompurify ^3.4.11`·`ip-address ^10.1.1`·`uuid ^11.1.1`·`brace-expansion@>=2.0.0 <2.0.3 → ^2.0.3`(1.x 보호 위해 range-scoped)·`postcss ^8.5.10`·`shell-quote ^1.8.4`·`@babel/core ^7.29.1`·`rollup ^4.59.0`(in-major). **O2(dev-only)**: `vitest ^4.0.18→^4.1.0` 시도했으나 **vitest 4.1+ 가 vite6 `./module-runner` export 요구 → ant-ui(vite ^5.4.21) 테스트가 `ERR_PACKAGE_PATH_NOT_EXPORTED` 로 깨짐**. O2 원칙대로 revert + `~4.0.18` 로 캡(>= 4.0.18 <4.1.0; `^` 로는 4.1.9 가 범위 내라 다운그레이드 안 됨 — 함정). vite5→6 뒤에 묶인 잔존 7 GHSA(vitest CRIT GHSA-5xrq-8626-4rwp + vite HIGH/mod ×5 + esbuild mod)는 **dev-server/build-tool only·CI(`vite build`/`vitest run`)·prod 미노출**이라 [pnpm-workspace.yaml](pnpm-workspace.yaml) `auditConfig.ignoreGhsas` 에 GHSA 별 사유 주석과 함께 명시 수용. **검증**: `pnpm audit` exit 0(런타임 0, 10 ignored), `pnpm build:cli`/`build:ui` green, `pnpm test:cli` **4905 passed**(8 skip), ant-ui `pnpm --filter @ant/ui test` **452 passed**. posture [Axis 2](docs/internals/security-posture.md) 갱신(수용 SSOT=overrides+auditConfig+narrative). 다음=P4.
