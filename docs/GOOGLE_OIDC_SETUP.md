# Google OIDC Authentication Setup Guide

This guide explains how to configure Google OpenID Connect (OIDC) authentication for ANT Works.

## What is OIDC?

**OIDC (OpenID Connect)** is an authentication layer built on top of OAuth 2.0:
- **OAuth 2.0**: Authorization protocol ("Can this app access my data?")
- **OIDC**: Authentication protocol ("Who are you?")

OIDC provides:
- User identity verification
- Standardized user information (email, name, profile picture)
- Secure token-based authentication

## Prerequisites

You need a Google Cloud Project with OAuth 2.0 credentials configured.

## Step 1: Create Google OAuth 2.0 Credentials

### 1.1 Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API (required for OIDC)

### 1.2 Configure OAuth Consent Screen

1. Navigate to **APIs & Services** > **OAuth consent screen**
2. Choose **External** (for testing) or **Internal** (for organization-only)
3. Fill in required fields:
   - App name: `ANT Works`
   - User support email: Your email
   - Developer contact: Your email
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
5. Save and continue

### 1.3 Create OAuth 2.0 Client ID

1. Navigate to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Choose **Application type**: Web application
4. Set **Authorized redirect URIs**:
   ```
   http://localhost:4100/api/auth/google/callback
   ```
   For production, add your production domain:
   ```
   https://your-domain.com/api/auth/google/callback
   ```
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 2: Configure Environment Variables

### 2.1 Backend Configuration (ant-cli)

Create or edit `.env` file in `packages/ant-cli/`:

#### Development (localhost)

**Recommended: Skip authentication for convenience**

```bash
# Skip authentication for localhost
SKIP_AUTH_FOR_LOCALHOST=true

# Google OIDC not required for localhost development
# (Optional: uncomment if you want to test OAuth flow)
# GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=your-client-secret-here
# GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback
```

#### Production

```bash
# Disable localhost skip (important for security)
SKIP_AUTH_FOR_LOCALHOST=false

# Google OIDC Configuration
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=https://ant.crosstoken.io/api/auth/google/callback

# Frontend URL (for OAuth redirects after authentication)
# Leave empty if frontend is on the same domain as backend
# FRONTEND_URL=https://ant.crosstoken.io
```

### 2.2 Frontend Configuration (ant-ui)

Create or edit `.env` file in `packages/ant-ui/`:

```bash
# Development
VITE_CLOUD_BACKEND_BASE=http://localhost:4100/api

# Production (same domain)
# VITE_CLOUD_BACKEND_BASE=/api

# Production (different domains)
# VITE_CLOUD_BACKEND_BASE=https://api.ant.crosstoken.io/api
```

### 2.3 Verify Configuration

Start the server and check the logs:

```bash
cd packages/ant-cli
npm run dev:server
```

You should see:
```
[ExpressServerAdapter] Google OIDC authentication enabled
```

If not configured, you'll see:
```
[ExpressServerAdapter] Google OIDC not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
```

## Step 3: Test Authentication

1. Start the backend server (Cloud mode):
   ```bash
   cd packages/ant-cli
   npm run dev:server
   ```

2. Start the frontend:
   ```bash
   cd packages/ant-ui
   npm run dev
   ```

3. Open browser at `http://localhost:5173`

4. Switch to **Cloud** mode in the top navbar

5. Click **Sign in with Google** button

6. Complete Google sign-in flow

7. You should be redirected back to the app with authentication complete

## Authentication Flow

```
┌─────────┐                ┌──────────────┐                ┌─────────┐
│ Browser │                │  ANT Backend │                │ Google  │
└────┬────┘                └──────┬───────┘                └────┬────┘
     │                             │                             │
     │  1. Click "Sign in with     │                             │
     │     Google"                 │                             │
     ├────────────────────────────>│                             │
     │                             │                             │
     │  2. Redirect to Google      │                             │
     │     OAuth consent screen    │                             │
     │<────────────────────────────┤                             │
     │                             │                             │
     │  3. User grants consent     │                             │
     ├─────────────────────────────┼────────────────────────────>│
     │                             │                             │
     │  4. Google redirects back   │                             │
     │     with authorization code │                             │
     │<────────────────────────────┼─────────────────────────────┤
     │                             │                             │
     │  5. Backend exchanges code  │                             │
     │     for ID token            │                             │
     │                             ├────────────────────────────>│
     │                             │                             │
     │                             │  6. Return ID token with    │
     │                             │     user info               │
     │                             │<────────────────────────────┤
     │                             │                             │
     │  7. Create/validate         │                             │
     │     workspace & redirect    │                             │
     │<────────────────────────────┤                             │
     │                             │                             │
```

## Security Notes

### Deployment Scenarios

#### Scenario 1: Same Domain (Recommended)

```
Frontend: https://ant.crosstoken.io
Backend:  https://ant.crosstoken.io/api
```

**Backend `.env`**:
```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://ant.crosstoken.io/api/auth/google/callback
# FRONTEND_URL is empty (same domain)
```

**Frontend `.env`**:
```bash
VITE_CLOUD_BACKEND_BASE=/api
```

**Google Console Redirect URI**:
```
https://ant.crosstoken.io/api/auth/google/callback
```

#### Scenario 2: Different Domains

```
Frontend: https://ant.crosstoken.io
Backend:  https://api.ant.crosstoken.io
```

**Backend `.env`**:
```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://api.ant.crosstoken.io/api/auth/google/callback
FRONTEND_URL=https://ant.crosstoken.io
```

**Frontend `.env`**:
```bash
VITE_CLOUD_BACKEND_BASE=https://api.ant.crosstoken.io/api
```

**Google Console Redirect URI**:
```
https://api.ant.crosstoken.io/api/auth/google/callback
```

#### Scenario 3: Development (localhost)

```
Frontend: http://localhost:5173
Backend:  http://localhost:4100
```

**Option A: Skip Authentication (Recommended for Development)**

**Backend `.env`**:
```bash
# Skip auth for localhost (no Google OAuth needed)
SKIP_AUTH_FOR_LOCALHOST=true

# Optional: Set Google credentials if you want to test OAuth flow
# GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=your-client-secret
# GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback
```

**Frontend `.env`**:
```bash
VITE_CLOUD_BACKEND_BASE=http://localhost:4100/api
```

With `SKIP_AUTH_FOR_LOCALHOST=true`, all requests from localhost will automatically use a default dev user (`dev@localhost`) without requiring authentication.

**Option B: Test OAuth Flow (Optional)**

**Backend `.env`**:
```bash
SKIP_AUTH_FOR_LOCALHOST=false  # or remove this line

GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback
```

**Frontend `.env`**:
```bash
VITE_CLOUD_BACKEND_BASE=http://localhost:4100/api
```

**Google Console Redirect URI** (only if testing OAuth):
```
http://localhost:4100/api/auth/google/callback
```

### Production Deployment

1. **Use HTTPS**: Always use HTTPS in production
2. **Update Redirect URI**: Update Google OAuth settings with production domain
3. **Store Secrets Securely**: Never commit `.env` file to version control
4. **Restrict Client ID**: Configure authorized domains in Google Console

### Environment Variables Security

Add to `.gitignore`:
```
.env
.env.local
.env.production
```

### Token Storage

- User information is stored in browser `localStorage`
- No sensitive tokens are stored client-side
- Backend verifies ID tokens with Google on each authentication

## Troubleshooting

### Error: "Google authentication not configured"

**Solution**: Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env`

### Error: "redirect_uri_mismatch"

**Solution**: 
1. Check that redirect URI in Google Console exactly matches the one in your `.env`
2. Include the protocol (`http://` or `https://`)
3. Include the port for local development (`:4100`)

### Error: "email_not_verified"

**Solution**: The Google account email must be verified. Verify the email in Google account settings.

### Error: "Access blocked: This app hasn't been verified"

**Solution**: 
- For testing: Click "Advanced" > "Go to ANT Works (unsafe)"
- For production: Submit app for Google verification

## Legacy Email-based Authentication

The system still supports legacy email-based authentication (for `@to.nexus` organization only):
- Sign Up: Creates workspace without verification
- Sign In: Validates workspace exists

This is maintained for backward compatibility but should be migrated to OIDC for production.

## API Endpoints

### Google OIDC Flow

- `GET /api/auth/google` - Initiate Google OAuth flow
- `GET /api/auth/google/callback` - OAuth callback handler

### Legacy Endpoints

- `POST /api/auth/signup` - Email-based signup (legacy)
- `POST /api/auth/signin` - Email-based signin (legacy)
- `POST /api/auth/signout` - Sign out (clears client-side state)

## Next Steps

1. ✅ Configure Google OAuth credentials
2. ✅ Set environment variables
3. ✅ Test authentication flow
4. Consider:
   - Adding more OAuth providers (GitHub, Microsoft, etc.)
   - Implementing role-based access control
   - Adding session management with refresh tokens
   - Setting up user profile management

## Support

For issues or questions:
- Check server logs: `packages/ant-cli` console output
- Check browser console: Network tab for OAuth requests
- Review Google OAuth documentation: https://developers.google.com/identity/protocols/oauth2
