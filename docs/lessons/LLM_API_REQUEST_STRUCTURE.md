# LLM API 요청 구조 (용어 정리)

## 🎯 핵심 용어 정의

### 1. **메시지 (Messages)** = LLM API 요청의 기본 단위

```typescript
// LLM에 보내는 데이터의 최상위 구조
messages: [
  {
    role: 'user',     // 누가 말하는가
    content: '...'    // 무엇을 말하는가
  }
]
```

### 2. **프롬프트 (Prompt)** = content 안의 실제 텍스트

```typescript
{
  role: 'user',
  content: `
    You are an expert developer.
    
    # Directive
    Add logout button
    
    # Codebase
    [코드 내용]
    
    Generate code...
  `  // ← 이게 프롬프트!
}
```

### 3. **컨텍스트 (Context)** = 프롬프트에 포함되는 입력 데이터들

```typescript
// 프롬프트를 구성하는 요소들
context = {
  directive: "Add logout button",     // 지시사항
  design: "# Design Document...",     // 디자인 문서
  code: "=== src/App.tsx ===\n...",  // 코드베이스
  lessons: "1. React 패턴...",        // 레슨
  task: { name: "...", ... }          // 현재 태스크
}
```

### 4. **토큰 (Token)** = 텍스트를 나눈 작은 단위 (LLM 처리 단위)

```typescript
// 예시
"Hello world" 
  → ['Hello', ' world']  // 2개 토큰
  
"안녕하세요"
  → ['안녕', '하', '세요']  // 3개 토큰 (한글은 더 많이 쪼개짐)
  
// 대략 추정
- 영어: 4글자 ≈ 1토큰
- 한글: 1글자 ≈ 1토큰
- 코드: 4글자 ≈ 1토큰
```

---

## 📦 LLM API 요청 구조 (실제)

### Anthropic API (Claude) 호출 예시

```typescript
// packages/ant-cli/src/periphery/adapters/llm/AnthropicLLMClient.ts

const stream = await this.client.messages.create({
  // 1. 모델 선택
  model: 'claude-sonnet-4-20250514',
  
  // 2. 최대 출력 토큰 (LLM 응답 길이 제한)
  max_tokens: 16000,
  
  // 3. 사고 과정 활성화 (Extended Thinking)
  thinking: {
    type: 'enabled',
    budget_tokens: 10000  // 사고 토큰 예산
  },
  
  // 4. 🔥 메시지 배열 (핵심!)
  messages: [
    {
      role: 'user',
      content: `
        You are an expert software architect...
        
        # Directive
        Add logout button to header
        
        # Current Codebase
        === src/auth/login.ts ===
        \`\`\`typescript
        function login(username, password) { ... }
        \`\`\`
        
        === src/components/Header.tsx ===
        \`\`\`typescript
        export function Header() { ... }
        \`\`\`
        
        # Previous Learnings
        1. React component pattern...
        2. Authentication logic...
        
        # Current Task
        - Name: Add logout button
        - Type: component
        
        Generate code...
      `
    }
  ],
  
  // 5. 도구 (Tools) - LLM이 사용할 수 있는 함수
  tools: [
    {
      name: 'write_file',
      description: 'Write or update a file',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    },
    {
      name: 'run_command',
      description: 'Execute a shell command',
      input_schema: { ... }
    }
  ],
  
  // 6. 스트리밍 활성화
  stream: true
});
```

---

## 🔄 전체 흐름: 데이터 → 메시지 → 프롬프트 → 토큰

```
┌─────────────────────────────────────────────────────────────────┐
│ 1️⃣ 원본 데이터 (Context)                                        │
└─────────────────────────────────────────────────────────────────┘

const context = {
  directive: "Add logout button",
  design: "# Design Document\n...",
  code: "=== src/App.tsx ===\n...",     // 15개 파일
  lessons: ["React pattern...", ...],    // 5개 레슨
  task: { name: "Add logout button", ... }
}

┌─────────────────────────────────────────────────────────────────┐
│ 2️⃣ 프롬프트 빌드 (PromptEngine)                                 │
└─────────────────────────────────────────────────────────────────┘

const template = await promptPort.load('execute', 'code');
// Handlebars 템플릿
/*
You are {{role}}.

# Directive
{{directive}}

# Current Codebase
{{currentCode}}

# Learnings
{{lessons}}
...
*/

const prompt = Handlebars.compile(template)(context);
// 결과: 완성된 프롬프트 (큰 텍스트 문자열)

┌─────────────────────────────────────────────────────────────────┐
│ 3️⃣ 메시지 생성                                                  │
└─────────────────────────────────────────────────────────────────┘

const messages = [
  {
    role: 'user',
    content: prompt  // 위에서 만든 프롬프트
  },
  // 대화 히스토리 (재시도 시)
  {
    role: 'assistant',
    content: "I'll create a logout button..."
  },
  {
    role: 'user',
    content: "Please use the existing Button component"
  }
];

┌─────────────────────────────────────────────────────────────────┐
│ 4️⃣ 토큰 계산 (LLM 내부)                                        │
└─────────────────────────────────────────────────────────────────┘

// LLM이 자동으로 토큰화
prompt (텍스트 60,000자)
  → Tokenizer
  → [토큰1, 토큰2, ..., 토큰15000]  // ~15K 토큰

예시:
"function login(username, password) {"
  → ['function', ' login', '(', 'username', ',', ' password', ')', ' {']
  → 8개 토큰

┌─────────────────────────────────────────────────────────────────┐
│ 5️⃣ LLM API 호출                                                 │
└─────────────────────────────────────────────────────────────────┘

POST https://api.anthropic.com/v1/messages
{
  model: 'claude-sonnet-4',
  max_tokens: 16000,       // 출력 토큰 제한
  messages: [...]          // 위에서 만든 메시지들
}

입력 토큰: ~15K (프롬프트)
출력 토큰: ~3K (LLM 응답)
총 토큰: ~18K
```

---

## 📚 용어 비교표

| 용어 | 정의 | 예시 | 위치 |
|-----|------|------|------|
| **Request** | LLM API 전체 호출 | `messages.create({...})` | API 레벨 |
| **Messages** | 대화 기록 배열 | `[{role:'user', content:'...'}, ...]` | API 파라미터 |
| **Message** | 단일 발화 | `{role:'user', content:'...'}` | 배열 요소 |
| **Role** | 발화자 | `'user'`, `'assistant'`, `'system'` | Message 속성 |
| **Content** | 발화 내용 (프롬프트) | `"You are..."` | Message 속성 |
| **Prompt** | Content의 텍스트 | 전체 지시사항 문자열 | Content 내부 |
| **Context** | 프롬프트 구성 요소 | 지시사항, 코드, 레슨 등 | 데이터 |
| **Token** | 텍스트 처리 단위 | `['Hello', ' world']` | LLM 내부 |
| **Tools** | LLM이 호출 가능한 함수 | `write_file`, `run_command` | API 파라미터 |

---

## 💡 자주 하는 오해

### ❌ 잘못된 이해
```
"프롬프트를 LLM에 보낸다"
→ 프롬프트는 메시지의 content일 뿐
```

### ✅ 올바른 이해
```
"메시지를 LLM에 보낸다"
"메시지의 content에 프롬프트가 들어있다"
```

---

### ❌ 잘못된 이해
```
"코드와 레슨을 LLM에 보낸다"
→ 코드와 레슨은 별도 파라미터가 아님
```

### ✅ 올바른 이해
```
"프롬프트에 코드와 레슨을 포함시켜서 보낸다"
"프롬프트 = 템플릿 + (코드, 레슨, 지시사항 등)"
```

---

### ❌ 잘못된 이해
```
"토큰 = 입력 데이터"
→ 토큰은 단위일 뿐
```

### ✅ 올바른 이해
```
"토큰 = 텍스트를 나눈 작은 조각"
"입력 데이터 → 텍스트 → 토큰화 → N개 토큰"
```

---

## 🎯 실제 예시: "Add logout button" 요청

### 1️⃣ Context (원본 데이터)

```typescript
const context = {
  directive: "Add logout button to header",
  
  design: `
    # Design Document
    - Header component at top
    - Logout button should be visible when logged in
    - Use existing Button component
  `,
  
  code: `
    === src/components/Header.tsx ===
    \`\`\`typescript
    export function Header() {
      return <nav>...</nav>;
    }
    \`\`\`
    
    === src/components/Button.tsx ===
    \`\`\`typescript
    export function Button({ onClick, children }) {
      return <button onClick={onClick}>{children}</button>;
    }
    \`\`\`
    
    === src/auth/logout.ts ===
    \`\`\`typescript
    export function logout() {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    \`\`\`
  `,
  
  lessons: `
    📚 Previous Learnings:
    
    1. React Component Pattern
       - Always use TypeScript
       - Use functional components
       - Props should be typed
    
    2. Authentication Logic
       - logout() removes token from localStorage
       - Redirect to /login after logout
  `,
  
  task: {
    name: "Add logout button to header",
    type: "component",
    priority: "high"
  }
}
```

**크기**: ~2,000 글자 → **~500 토큰**

---

### 2️⃣ Prompt (템플릿 적용 후)

```typescript
const prompt = `
You are an expert software architect and developer.

# Directive
Add logout button to header

# Design Document
- Header component at top
- Logout button should be visible when logged in
- Use existing Button component

# Current Codebase
=== src/components/Header.tsx ===
\`\`\`typescript
export function Header() {
  return <nav>...</nav>;
}
\`\`\`

=== src/components/Button.tsx ===
\`\`\`typescript
export function Button({ onClick, children }) {
  return <button onClick={onClick}>{children}</button>;
}
\`\`\`

=== src/auth/logout.ts ===
\`\`\`typescript
export function logout() {
  localStorage.removeItem('token');
  window.location.href = '/login';
}
\`\`\`

# Previous Learnings
1. React Component Pattern
   - Always use TypeScript
   - Use functional components
   - Props should be typed

2. Authentication Logic
   - logout() removes token from localStorage
   - Redirect to /login after logout

# Current Task
- Name: Add logout button to header
- Type: component
- Priority: high

# Instructions
1. Analyze the existing code patterns
2. Follow the design document requirements
3. Use the existing Button component
4. Import and use the logout function
5. Add the logout button to the Header component

Generate code using the write_file tool.
`;
```

**크기**: ~3,500 글자 → **~900 토큰**

---

### 3️⃣ Messages (LLM API 형식)

```typescript
const messages = [
  {
    role: 'user',
    content: prompt  // 위의 프롬프트 전체
  }
];
```

**전체 구조**:
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 16000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [
    {
      "role": "user",
      "content": "[3,500글자 프롬프트]"
    }
  ],
  "tools": [
    {
      "name": "write_file",
      "description": "Write or update a file",
      "input_schema": {...}
    }
  ],
  "stream": true
}
```

---

### 4️⃣ Tokens (LLM 내부 처리)

```typescript
// 입력 토큰화
"You are an expert software architect"
  → ['You', ' are', ' an', ' expert', ' software', ' architect']
  → 6 토큰

"function Header() {"
  → ['function', ' Header', '()', ' {']
  → 4 토큰

// 전체 토큰 계산
프롬프트 3,500글자
  ÷ 4 (평균)
  ≈ 875 토큰

// 실제 계산 (더 정확)
입력 토큰: 900 토큰
출력 토큰: 500 토큰 (LLM 응답)
사고 토큰: 200 토큰 (Extended Thinking)
───────────────────
총 토큰: 1,600 토큰
```

---

## 📊 토큰 비용 (참고)

### Anthropic Claude Sonnet 4

| 항목 | 비용 |
|-----|------|
| **입력 토큰** | $3 / 1M 토큰 |
| **출력 토큰** | $15 / 1M 토큰 |
| **캐시 읽기** | $0.30 / 1M 토큰 (90% 절약) |
| **캐시 쓰기** | $3.75 / 1M 토큰 |

### 예시 계산
```typescript
// 1회 요청
입력: 15,000 토큰 × $3 / 1M = $0.045
출력: 3,000 토큰 × $15 / 1M = $0.045
────────────────────────────────
총: $0.09 (약 120원)

// 프롬프트 캐싱 사용 시
입력 (캐시됨): 15,000 토큰 × $0.30 / 1M = $0.0045
출력: 3,000 토큰 × $15 / 1M = $0.045
────────────────────────────────
총: $0.05 (약 65원, 45% 절약)
```

---

## 🎯 정리

### 계층 구조
```
Request (API 호출)
  └─ Messages (배열)
      └─ Message (객체)
          ├─ role: 'user'
          └─ content: Prompt (문자열)
              └─ Context (데이터)
                  ├─ 지시사항
                  ├─ 코드
                  ├─ 레슨
                  └─ 태스크
```

### 변환 과정
```
데이터 (context)
  → 템플릿 적용 (Handlebars)
  → 프롬프트 (prompt)
  → 메시지 content (message.content)
  → 메시지 배열 (messages)
  → API 요청 (request)
  → 토큰화 (tokenization)
  → LLM 처리
```

### 핵심 개념
- **Message** = 구조화된 대화 단위
- **Prompt** = 실제 지시사항 텍스트
- **Context** = 프롬프트를 구성하는 데이터
- **Token** = LLM이 처리하는 최소 단위

이제 LLM API 요청 구조가 명확하게 이해되셨나요? 🎉

