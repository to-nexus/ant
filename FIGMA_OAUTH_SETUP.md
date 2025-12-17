# Figma OAuth 2.0 Setup Guide

## 1. Figma Developer Portal에서 OAuth 앱 생성

### Step 1: 앱 생성
1. https://www.figma.com/developers/apps 접속
2. **"Create a new app"** 클릭
3. 앱 정보 입력:
   - **App Name**: ANT Works (또는 원하는 이름)
   - **Website**: https://your-domain.com
   - **App Logo**: 100x100px PNG 이미지 (선택사항)

### Step 2: OAuth Credentials 받기
앱 생성 후 자동으로 발급되는 정보:
- ✅ **Client ID**: 공개 가능한 클라이언트 ID
- ✅ **Client Secret**: **한 번만 표시됨!** 반드시 안전하게 저장

⚠️ **중요**: Client Secret은 한 번만 표시되므로 즉시 복사해서 저장하세요!

### Step 3: OAuth Settings 구성
1. **Redirect URI 추가**:
   - Local 개발: `http://localhost:54112/api/figma/oauth/callback`
   - Production: `https://your-domain.com/api/figma/oauth/callback`

2. **OAuth Scopes 선택**:
   - `file_content:read` - 파일 콘텐츠 읽기
   - `file_comments:write` - 댓글 작성 (필요시)
   - 필요한 scope만 최소한으로 선택

3. **App Type 선택**:
   - **Private**: 팀/조직 내부에서만 사용 (승인 불필요)
   - **Public**: 모든 Figma 사용자에게 공개 (Figma 승인 필요)

## 2. ANT 프로젝트 설정

### `.env` 파일에 추가

```bash
# Figma OAuth 2.0 Configuration
FIGMA_CLIENT_ID=your_client_id_from_figma
FIGMA_CLIENT_SECRET=your_client_secret_from_figma
FIGMA_REDIRECT_URI=http://localhost:54112/api/figma/oauth/callback
```

**파일 위치**: `/Users/probe/dev/ant/packages/ant-cli/.env`

### 서버 재시작

```bash
# 터미널에서 실행
cd /Users/probe/dev/ant
pnpm dev
```

## 3. 사용 방법

### Frontend에서 연결
1. ANT UI 접속: http://localhost:4200
2. **Settings** → **Figma Integration**
3. **"Connect with Figma"** 버튼 클릭
4. Figma 로그인 페이지에서 인증
5. 권한 승인 → 자동으로 Access Token 저장

### OAuth Flow
```
User clicks "Connect with Figma"
  ↓
Frontend: GET /api/figma/oauth/authorize?user-email=xxx
  ↓
Redirect to: https://www.figma.com/oauth?client_id=...
  ↓
User logs in to Figma & authorizes
  ↓
Figma redirects to: /api/figma/oauth/callback?code=...&state=...
  ↓
Backend exchanges code for access_token
  ↓
Save access_token to encrypted credentials.json
  ↓
Show success message ✅
```

## 4. 저장 위치

### User-level Credentials (암호화됨)
```
workspaces/{org}/{user}/.ant/credentials.json
```

**내용**:
```json
{
  "figma": {
    "accessToken": "encrypted_access_token",
    "refreshToken": "encrypted_refresh_token",
    "userId": "figma_user_id",
    "email": "user@figma.com",
    "expiresAt": "2024-12-31T...",
    "updatedAt": "2024-12-17T..."
  }
}
```

### Integration Settings
```
workspaces/{org}/{user}/.ant/integrations.json
```

**내용**:
```json
{
  "figma": {
    "enabled": true,
    "defaultFileFormat": "svg",
    "autoExtractTokens": true,
    "autoGenerateCode": false
  }
}
```

## 5. Troubleshooting

### "Figma OAuth not configured" 에러
- `.env` 파일에 `FIGMA_CLIENT_ID`가 설정되어 있는지 확인
- 서버를 재시작했는지 확인

### "Invalid redirect_uri" 에러
- Figma Developer Portal에서 Redirect URI가 정확히 등록되어 있는지 확인
- `.env`의 `FIGMA_REDIRECT_URI`와 일치하는지 확인

### "Invalid client_secret" 에러
- Client Secret이 올바른지 확인
- Client Secret에 공백이나 줄바꿈이 없는지 확인

### Token Exchange 실패
- Figma API 문서에서는 `Content-Type: application/json` 사용
- 코드에서 이미 수정됨 ✅

## 6. API Endpoints

### Check Status
```bash
GET /api/figma/config?user-email=local@local
```

### Start OAuth
```bash
GET /api/figma/oauth/authorize?user-email=local@local
```

### Disconnect
```bash
POST /api/figma/oauth/disconnect
```

## 7. Security Notes

- ✅ Client Secret은 `.env` 파일에만 저장 (절대 Git에 커밋하지 마세요!)
- ✅ Access Token은 AES-256-GCM으로 암호화되어 저장
- ✅ `ANT_ENCRYPTION_KEY`는 `.env`에 별도로 관리
- ✅ User-level 격리 (각 사용자별로 독립적인 credentials)

## 8. References

- Figma Developer Portal: https://www.figma.com/developers/apps
- Figma OAuth Docs: https://developers.figma.com/docs/rest-api/authentication/
- Figma REST API: https://www.figma.com/developers/api

---

## Quick Start Checklist

- [ ] Figma 앱 생성
- [ ] Client ID/Secret 받기
- [ ] Redirect URI 등록
- [ ] `.env` 파일에 추가
- [ ] 서버 재시작
- [ ] UI에서 "Connect with Figma" 클릭
- [ ] 테스트 완료! 🎉
