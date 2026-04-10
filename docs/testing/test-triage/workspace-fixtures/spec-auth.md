# Spec: Authentication System

## Overview

TaskFlow의 사용자 인증 시스템 구현 스펙. 회원가입, 이메일 인증, 로그인, 토큰 갱신을 포함한다.

**PRD References**: FR-01, FR-02, FR-03, FR-04
**System Design References**: AuthService, users table, JWT Middleware

---

## Task Breakdown

### Task 1: User Model & Repository

**Scope**: users 테이블 생성 및 데이터 접근 레이어 구현

**Implementation**:
- PostgreSQL migration: users 테이블 생성 (id, email, password_hash, email_verified, created_at)
- `UserRepository` 클래스: findByEmail, findById, create, updateEmailVerified

**Acceptance Criteria**:
- [ ] users 테이블이 email UNIQUE 제약을 갖는다
- [ ] findByEmail이 존재하지 않는 이메일에 대해 null을 반환한다
- [ ] create가 UUID id를 자동 생성한다

---

### Task 2: Registration Endpoint

**Scope**: POST /api/auth/register 구현

**Implementation**:
- Request validation: email (valid format), password (min 8 chars)
- Password hashing: bcrypt with salt rounds 12
- Duplicate email check → 409 Conflict
- User creation → 201 Created
- Email verification token 생성 및 이메일 발송 (async)

**Acceptance Criteria**:
- [ ] 유효한 이메일과 비밀번호로 회원가입 성공 (201)
- [ ] 중복 이메일 시 409 반환
- [ ] 비밀번호 8자 미만 시 400 반환
- [ ] 비밀번호가 bcrypt 해시로 저장된다
- [ ] 회원가입 성공 시 인증 이메일이 발송된다

---

### Task 3: Email Verification

**Scope**: GET /api/auth/verify?token=xxx 구현

**Implementation**:
- Verification token: JWT with userId, 24h expiry
- Token 검증 → email_verified = true 업데이트
- 이미 인증된 사용자 → 200 (idempotent)
- 만료/유효하지 않은 토큰 → 400

**Acceptance Criteria**:
- [ ] 유효한 토큰으로 이메일 인증 성공
- [ ] 인증 후 email_verified가 true로 변경된다
- [ ] 만료된 토큰에 대해 400 반환
- [ ] 이미 인증된 사용자에 대해 200 반환 (idempotent)

---

### Task 4: Login Endpoint

**Scope**: POST /api/auth/login 구현

**Implementation**:
- Request validation: email, password
- User lookup → bcrypt compare
- email_verified 확인 → 미인증 시 403
- JWT access token (1h) + refresh token (7d) 발급
- Refresh token을 Redis에 저장 (7d TTL)

**Acceptance Criteria**:
- [ ] 올바른 자격 증명으로 로그인 성공 (200), access + refresh token 반환
- [ ] 잘못된 비밀번호 시 401 반환
- [ ] 존재하지 않는 이메일 시 401 반환 (동일 에러 — timing attack 방지)
- [ ] 이메일 미인증 시 403 반환
- [ ] Access token payload에 sub(userId), email 포함

---

### Task 5: Token Refresh Endpoint

**Scope**: POST /api/auth/refresh 구현

**Implementation**:
- Request body: refreshToken
- Redis에서 refresh token 유효성 확인
- 유효 시 새 access token 발급
- 무효/만료 시 401

**Acceptance Criteria**:
- [ ] 유효한 refresh token으로 새 access token 발급 (200)
- [ ] 만료된 refresh token에 대해 401 반환
- [ ] Redis에 없는 refresh token에 대해 401 반환

---

### Task 6: JWT Middleware

**Scope**: 인증 필요 라우트에 적용할 JWT 검증 미들웨어

**Implementation**:
- Authorization: Bearer {token} 헤더 파싱
- JWT 서명 검증 + 만료 확인
- 검증 성공 시 req.user에 userId, email 주입
- 검증 실패 시 401

**Acceptance Criteria**:
- [ ] 유효한 토큰 시 req.user가 설정된다
- [ ] Authorization 헤더 누락 시 401
- [ ] 만료된 토큰 시 401
- [ ] 잘못된 서명 시 401
