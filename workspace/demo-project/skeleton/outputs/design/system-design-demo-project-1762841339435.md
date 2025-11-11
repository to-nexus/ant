# CoinWatcher System Design Document

## Document Control
- **Version:** 1.0
- **Last Updated:** 2024
- **Status:** Implementation Ready
- **Author:** System Architect

---

## 1. Overview

### 1.1 System Purpose and Goals

CoinWatcher is a real-time cryptocurrency price monitoring web application that provides users with instant access to current market data for popular cryptocurrencies. The system aims to deliver a simple, responsive, and reliable interface for casual crypto enthusiasts and traders to track coin prices without the complexity of full-featured trading platforms.

**Primary Goals:**
- Provide real-time cryptocurrency price information with 10-second refresh intervals
- Enable quick search and discovery of cryptocurrency data
- Deliver a fast, responsive user experience with minimal latency
- Maintain API rate limit compliance while ensuring data freshness
- Support multiple currency display options (USD/KRW)

### 1.2 Key Stakeholders

| Stakeholder | Role | Primary Concerns |
|------------|------|------------------|
| End Users | Crypto enthusiasts, casual traders | Fast load times, accurate data, simple UI |
| Development Team | Implementation and maintenance | Clean architecture, maintainability, testing |
| CoinGecko API | External data provider | Rate limit compliance, proper attribution |

### 1.3 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Next.js Frontend Application                  │ │
│  │                                                          │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │ │
│  │  │   UI     │  │  State   │  │    API Service       │ │ │
│  │  │Components│◄─┤Management│◄─┤    Layer (SWR)       │ │ │
│  │  │(React)   │  │  Layer   │  │                      │ │ │
│  │  └──────────┘  └──────────┘  └──────────┬───────────┘ │ │
│  │                                          │             │ │
│  └──────────────────────────────────────────┼─────────────┘ │
└─────────────────────────────────────────────┼───────────────┘
                                              │
                                              │ HTTPS
                                              ▼
                                 ┌────────────────────────┐
                                 │   CoinGecko API        │
                                 │   (External Service)   │
                                 └────────────────────────┘
```

### 1.4 Core Use Cases

**UC-1: View Default Coin List**
- User opens the application
- System displays list of major cryptocurrencies (BTC, ETH, SOL, XRP, DOGE)
- Prices auto-refresh every 10 seconds

**UC-2: Search for Specific Cryptocurrency**
- User enters coin name or symbol in search bar
- System filters coin list in real-time
- User views matching results with current prices

**UC-3: Toggle Currency Display**
- User clicks currency toggle (USD/KRW)
- System converts and displays all prices in selected currency
- Preference persists across page refreshes

**UC-4: Monitor Price Changes**
- System automatically fetches updated prices every 10 seconds
- UI updates without full page reload
- Price change indicators show 24h movement

---

## 2. Architecture

### 2.1 System Architecture

**Architecture Style:** Single Page Application (SPA) with Server-Side Rendering (SSR) capability

**Core Principles:**
- **Component-Based Design:** Atomic, reusable React components
- **Unidirectional Data Flow:** Top-down state propagation
- **API-First:** Clear separation between data fetching and presentation
- **Progressive Enhancement:** Works with JavaScript disabled (initial SSR)

**Technology Foundation:**
- **Frontend Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5.x
- **Styling:** TailwindCSS 3.x
- **Data Fetching:** SWR (stale-while-revalidate)
- **Build Tool:** Turbopack (Next.js native)

### 2.2 Component Architecture

```
app/
├── layout.tsx (Root Layout)
├── page.tsx (Home Page)
└── components/
    ├── CoinList/
    │   ├── CoinList.tsx (Container)
    │   ├── CoinCard.tsx (Presentation)
    │   └── CoinListSkeleton.tsx (Loading State)
    ├── SearchBar/
    │   └── SearchBar.tsx
    ├── CurrencyToggle/
    │   └── CurrencyToggle.tsx
    ├── Header/
    │   └── Header.tsx
    └── ErrorBoundary/
        └── ErrorBoundary.tsx
```

**Component Hierarchy:**

```
┌─────────────────────────────────────────────┐
│              Layout (Root)                   │
│  ┌───────────────────────────────────────┐  │
│  │           Header                       │  │
│  │  ┌──────────────┐  ┌───────────────┐  │  │
│  │  │  SearchBar   │  │CurrencyToggle │  │  │
│  │  └──────────────┘  └───────────────┘  │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │          Page (Home)                   │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │        CoinList                  │  │  │
│  │  │  ┌──────────┐  ┌──────────┐     │  │  │
│  │  │  │ CoinCard │  │ CoinCard │ ... │  │  │
│  │  │  └──────────┘  └──────────┘     │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Major Components:**

| Component | Responsibility | Type |
|-----------|---------------|------|
| Layout | Root shell, global state, theme | Container |
| Header | Branding, search, currency toggle | Container |
| SearchBar | Coin filtering input | Controlled |
| CurrencyToggle | USD/KRW selection | Controlled |
| CoinList | Fetch and manage coin data | Container |
| CoinCard | Display individual coin info | Presentation |
| ErrorBoundary | Graceful error handling | HOC |

### 2.3 Data Architecture

**Data Flow Pattern:**

```
External API → API Service Layer → SWR Cache → React State → UI Components
     ↑                                  │                         │
     └──────────────────────────────────┴─────────────────────────┘
                     Polling (10s interval)
```

**State Management Strategy:**

1. **Server State (SWR):**
   - Cryptocurrency price data
   - Market statistics
   - Coin metadata

2. **Client State (React useState):**
   - Search query
   - Currency selection (USD/KRW)
   - UI state (loading, errors)

3. **Persistent State (localStorage):**
   - Currency preference
   - User watchlist (future)

**Data Storage:**

- **In-Memory Cache (SWR):** 60-second TTL for API responses
- **Browser Storage (localStorage):** User preferences
- **Session Storage:** None required for MVP

### 2.4 Integration Architecture

**External Dependencies:**

```
┌──────────────────────────────────────────────┐
│         CoinWatcher Application               │
│                                               │
│  ┌──────────────────────────────────────┐   │
│  │      API Service Layer               │   │
│  │                                       │   │
│  │  ┌────────────────────────────────┐  │   │
│  │  │   CoinGecko Client             │  │   │
│  │  │   - HTTP Client (fetch)        │  │   │
│  │  │   - Rate Limiter               │  │   │
│  │  │   - Error Handler              │  │   │
│  │  │   - Response Transformer       │  │   │
│  │  └────────────────┬───────────────┘  │   │
│  └───────────────────┼───────────────────┘   │
└────────────────────────┼───────────────────────┘
                         │ HTTPS REST API
                         ▼
         ┌───────────────────────────────┐
         │   CoinGecko API v3            │
         │   - api.coingecko.com         │
         │   - Free Tier: 10-30 req/min  │
         │   - No Authentication         │
         └───────────────────────────────┘
```

**API Communication:**
- **Protocol:** HTTPS REST
- **Rate Limit:** 10-30 requests/minute (free tier)
- **Timeout:** 10 seconds per request
- **Retry Strategy:** Exponential backoff (3 attempts max)

---

## 3. Detailed Design

### 3.1 Component Design

#### 3.1.1 CoinList Component

**Purpose:** Container component responsible for fetching, managing, and displaying the list of cryptocurrencies.

**Internal Structure:**

```typescript
// File: components/CoinList/CoinList.tsx

interface CoinListProps {
  searchQuery: string;
  currency: 'usd' | 'krw';
}

interface CoinListState {
  filteredCoins: CoinData[];
  isRefreshing: boolean;
}
```

**Responsibilities:**
- Fetch coin data via SWR with 10-second revalidation
- Filter coins based on search query
- Handle loading and error states
- Pass data to CoinCard components
- Manage auto-refresh cycle

**Key Logic:**

```typescript
// Pseudo-code for filtering
const filteredCoins = useMemo(() => {
  if (!searchQuery) return coins;
  
  return coins.filter(coin => 
    coin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    coin.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );
}, [coins, searchQuery]);
```

**Dependencies:**
- `useCoinPrices` hook (SWR wrapper)
- `CoinCard` component
- `CoinListSkeleton` component

**Error Handling:**
- Display user-friendly error message on API failure
- Show retry button
- Log errors to console for debugging
- Fallback to cached data if available

---

#### 3.1.2 CoinCard Component

**Purpose:** Presentational component for displaying individual cryptocurrency information.

**Interface:**

```typescript
interface CoinCardProps {
  coin: CoinData;
  currency: 'usd' | 'krw';
}

interface CoinData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
}
```

**Responsibilities:**
- Render coin image, name, and symbol
- Display current price in selected currency
- Show 24h price change with color coding (green/red)
- Format numbers with appropriate decimals and separators

**Visual States:**
- Default
- Hover (subtle scale animation)
- Price increase (green accent)
- Price decrease (red accent)

**Dependencies:**
- None (pure presentation)

---

#### 3.1.3 SearchBar Component

**Purpose:** Controlled input component for real-time coin filtering.

**Interface:**

```typescript
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}
```

**Responsibilities:**
- Capture user input
- Emit changes to parent component
- Display search icon and clear button
- Handle keyboard shortcuts (Ctrl+K to focus)

**Debouncing:**
- No debouncing required (filtering is client-side)
- Input updates immediately trigger filter

**Accessibility:**
- `role="search"`
- `aria-label="Search cryptocurrencies"`
- Keyboard navigable

---

#### 3.1.4 CurrencyToggle Component

**Purpose:** Toggle button for switching between USD and KRW display.

**Interface:**

```typescript
interface CurrencyToggleProps {
  currency: 'usd' | 'krw';
  onToggle: (currency: 'usd' | 'krw') => void;
}
```

**Responsibilities:**
- Toggle between USD and KRW
- Persist selection to localStorage
- Visual indication of current selection

**Implementation:**

```typescript
// Toggle logic
const handleToggle = () => {
  const newCurrency = currency === 'usd' ? 'krw' : 'usd';
  onToggle(newCurrency);
  localStorage.setItem('preferred-currency', newCurrency);
};
```

---

#### 3.1.5 ErrorBoundary Component

**Purpose:** Catch and handle React component errors gracefully.

**Responsibilities:**
- Catch rendering errors in child components
- Display fallback UI with error message
- Provide reload/retry action
- Log errors for monitoring

**Error States:**
- Component error (rendering failure)
- API error (handled separately in CoinList)
- Network error (offline detection)

---

### 3.2 Data Models

#### 3.2.1 Core Entities

**CoinData (Primary Entity)**

```typescript
interface CoinData {
  // Identifiers
  id: string;                          // CoinGecko ID (e.g., "bitcoin")
  symbol: string;                      // Ticker symbol (e.g., "BTC")
  name: string;                        // Full name (e.g., "Bitcoin")
  
  // Visual
  image: string;                       // Logo URL
  
  // Price Data
  current_price: number;               // Current price in selected currency
  market_cap: number;                  // Market capitalization
  total_volume: number;                // 24h trading volume
  
  // Change Metrics
  price_change_percentage_24h: number; // 24h change percentage
  
  // Metadata
  last_updated: string;                // ISO timestamp
}
```

**API Response Schema (CoinGecko)**

```typescript
interface CoinGeckoMarketResponse {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation: number | null;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number | null;
  max_supply: number | null;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  roi: {
    times: number;
    currency: string;
    percentage: number;
  } | null;
  last_updated: string;
}
```

**Data Transformation:**

```typescript
// Transform CoinGecko response to internal CoinData model
function transformCoinGeckoData(raw: CoinGeckoMarketResponse): CoinData {
  return {
    id: raw.id,
    symbol: raw.symbol.toUpperCase(),
    name: raw.name,
    image: raw.image,
    current_price: raw.current_price,
    market_cap: raw.market_cap,
    total_volume: raw.total_volume,
    price_change_percentage_24h: raw.price_change_percentage_24h,
    last_updated: raw.last_updated,
  };
}
```

---

#### 3.2.2 Application State Schema

**Global Application State:**

```typescript
interface AppState {
  // User Preferences
  currency: 'usd' | 'krw';
  
  // Search State
  searchQuery: string;
  
  // UI State
  isLoading: boolean;
  error: AppError | null;
}

interface AppError {
  type: 'network' | 'api' | 'rate_limit' | 'unknown';
  message: string;
  timestamp: number;
  retryable: boolean;
}
```

**SWR Cache Structure:**

```typescript
// Cache key format
const cacheKey = `/api/coins/${currency}`;

// Cache value structure
interface CachedCoinsData {
  data: CoinData[];
  timestamp: number;
  error?: AppError;
}
```

---

#### 3.2.3 Data Validation Rules

**CoinData Validation:**

```typescript
function validateCoinData(coin: unknown): coin is CoinData {
  return (
    typeof coin === 'object' &&
    coin !== null &&
    typeof (coin as CoinData).id === 'string' &&
    typeof (coin as CoinData).symbol === 'string' &&
    typeof (coin as CoinData).name === 'string' &&
    typeof (coin as CoinData).current_price === 'number' &&
    (coin as CoinData).current_price >= 0 &&
    typeof (coin as CoinData).price_change_percentage_24h === 'number'
  );
}
```

**Input Validation:**

```typescript
// Search query sanitization
function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Allow alphanumeric, space, hyphen
    .slice(0, 50); // Max 50 characters
}

// Currency validation
function isValidCurrency(value: unknown): value is 'usd' | 'krw' {
  return value === 'usd' || value === 'krw';
}
```

---

#### 3.2.4 Indexing and Query Optimization

**Client-Side Indexing:**

```typescript
// Create search index for fast filtering
interface CoinSearchIndex {
  byId: Map<string, CoinData>;
  bySymbol: Map<string, CoinData>;
  searchableTerms: Map<string, string[]>; // term -> coin IDs
}

function buildSearchIndex(coins: CoinData[]): CoinSearchIndex {
  const byId = new Map<string, CoinData>();
  const bySymbol = new Map<string, CoinData>();
  const searchableTerms = new Map<string, string[]>();
  
  coins.forEach(coin => {
    byId.set(coin.id, coin);
    bySymbol.set(coin.symbol.toLowerCase(), coin);
    
    // Index searchable terms
    const terms = [
      coin.name.toLowerCase(),
      coin.symbol.toLowerCase(),
    ];
    
    terms.forEach(term => {
      if (!searchableTerms.has(term)) {
        searchableTerms.set(term, []);
      }
      searchableTerms.get(term)!.push(coin.id);
    });
  });
  
  return { byId, bySymbol, searchableTerms };
}
```

---

### 3.3 API Design

#### 3.3.1 External API Integration (CoinGecko)

**Base Configuration:**

```typescript
const COINGECKO_CONFIG = {
  baseURL: 'https://api.coingecko.com/api/v3',
  timeout: 10000, // 10 seconds
  headers: {
    'Accept': 'application/json',
  },
};
```

**Endpoint: Get Market Data**

```typescript
// GET /coins/markets
interface GetMarketDataRequest {
  vs_currency: 'usd' | 'krw';
  ids?: string;        // Comma-separated coin IDs
  order?: string;      // market_cap_desc (default)
  per_page?: number;   // Number of results (1-250)
  page?: number;       // Page number
  sparkline?: boolean; // Include sparkline data
}

// Example request
const endpoint = '/coins/markets';
const params = {
  vs_currency: 'usd',
  ids: 'bitcoin,ethereum,solana,ripple,dogecoin',
  order: 'market_cap_desc',
  per_page: 50,
  page: 1,
  sparkline: false,
  price_change_percentage: '24h',
};

// Full URL
// https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum...
```

**Response Format:**

```json
[
  {
    "id": "bitcoin",
    "symbol": "btc",
    "name": "Bitcoin",
    "image": "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    "current_price": 43250.50,
    "market_cap": 846234567890,
    "market_cap_rank": 1,
    "total_volume": 23456789012,
    "high_24h": 43500.00,
    "low_24h": 42800.00,
    "price_change_24h": 450.50,
    "price_change_percentage_24h": 1.05,
    "last_updated": "2024-01-15T10:30:00.000Z"
  }
]
```

---

#### 3.3.2 Internal API Service Layer

**Service Architecture:**

```typescript
// File: lib/api/coinGeckoService.ts

interface CoinGeckoService {
  getMarketData(currency: 'usd' | 'krw'): Promise<CoinData[]>;
  searchCoins(query: string): Promise<CoinData[]>;
}

class CoinGeckoClient implements CoinGeckoService {
  private baseURL: string;
  private rateLimiter: RateLimiter;
  
  constructor(config: CoinGeckoConfig) {
    this.baseURL = config.baseURL;
    this.rateLimiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 60000, // 1 minute
    });
  }
  
  async getMarketData(currency: 'usd' | 'krw'): Promise<CoinData[]> {
    await this.rateLimiter.waitForToken();
    
    try {
      const response = await fetch(
        `${this.baseURL}/coins/markets?${new URLSearchParams({
          vs_currency: currency,
          ids: DEFAULT_COIN_IDS.join(','),
          order: 'market_cap_desc',
          per_page: '50',
          sparkline: 'false',
        })}`,
        {
          signal: AbortSignal.timeout(10000),
        }
      );
      
      if (!response.ok) {
        throw new APIError(response.status, response.statusText);
      }
      
      const data: CoinGeckoMarketResponse[] = await response.json();
      return data.map(transformCoinGeckoData);
      
    } catch (error) {
      throw this.handleError(error);
    }
  }
  
  private handleError(error: unknown): AppError {
    if (error instanceof TypeError) {
      return {
        type: 'network',
        message: 'Network connection failed',
        timestamp: Date.now(),
        retryable: true,
      };
    }
    
    if (error instanceof APIError && error.status === 429) {
      return {
        type: 'rate_limit',
        message: 'Rate limit exceeded',
        timestamp: Date.now(),
        retryable: true,
      };
    }
    
    return {
      type: 'unknown',
      message: 'An unexpected error occurred',
      timestamp: Date.now(),
      retryable: false,
    };
  }
}
```

---

#### 3.3.3 Rate Limiting Implementation

**Rate Limiter:**

```typescript
// File: lib/utils/rateLimiter.ts

interface RateLimiterConfig {
  maxRequests: number;  // Max requests per window
  windowMs: number;     // Time window in milliseconds
}

class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimiterConfig;
  
  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.tokens = config.maxRequests;
    this.lastRefill = Date.now();
  }
  
  async waitForToken(): Promise<void> {
    this.refillTokens();
    
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    
    // Wait until next refill
    const waitTime = this.config.windowMs - (Date.now() - this.lastRefill);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    this.refillTokens();
    this.tokens--;
  }
  
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed >= this.config.windowMs) {
      this.tokens = this.config.maxRequests;
      this.lastRefill = now;
    }
  }
}
```

---

#### 3.3.4 Error Handling and Retry Strategy

**Error Response Codes:**

| Status Code | Error Type | Action |
|-------------|-----------|--------|
| 429 | Rate Limit Exceeded | Wait and retry (exponential backoff) |
| 500-504 | Server Error | Retry up to 3 times |
| 400-404 | Client Error | Show error, no retry |
| Network Error | Connection Failed | Retry with backoff |

**Retry Logic:**

```typescript
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
  } = options;
  
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on client errors (4xx except 429)
      if (error instanceof APIError && 
          error.status >= 400 && 
          error.status < 500 && 
          error.status !== 429) {
        throw error;
      }
      
      // Calculate exponential backoff
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt),
        maxDelay
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}
```

---

### 3.4 User Interface Design

#### 3.4.1 Screen Layout

**Desktop Layout (≥1024px):**

```
┌─────────────────────────────────────────────────────┐
│  Header                                             │
│  ┌────────────────┐  ┌─────────────┐  ┌─────────┐  │
│  │ CoinWatcher    │  │  Search     │  │ USD/KRW │  │
│  └────────────────┘  └─────────────┘  └─────────┘  │
├─────────────────────────────────────────────────────┤
│  Main Content                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │  Coin Grid (4 columns)                      │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐│   │
│  │  │ BTC    │ │ ETH    │ │ SOL    │ │ XRP    ││   │
│  │  │ $43,250│ │ $2,340 │ │ $98.50 │ │ $0.62  ││   │
│  │  │ +1.2%  │ │ -0.5%  │ │ +3.4%  │ │ +0.8%  ││   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘│   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐│   │
│  │  │ DOGE   │ │ ...    │ │ ...    │ │ ...    ││   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘│   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Mobile Layout (<768px):**

```
┌───────────────────┐
│  Header           │
│  CoinWatcher      │
│  ┌─────────────┐  │
│  │  Search     │  │
│  └─────────────┘  │
│  [ USD | KRW ]    │
├───────────────────┤
│  Coin List        │
│  ┌─────────────┐  │
│  │  BTC        │  │
│  │  $43,250    │  │
│  │  +1.2%      │  │
│  └─────────────┘  │
│  ┌─────────────┐  │
│  │  ETH        │  │
│  │  $2,340     │  │
│  │  -0.5%      │  │
│  └─────────────┘  │
│  ...              │
└───────────────────┘
```

---

#### 3.4.2 Component Specifications

**CoinCard Visual Design:**

```
┌──────────────────────────────────┐
│  ┌──┐                            │
│  │🪙│  Bitcoin                   │
│  └──┘  BTC                       │
│                                   │
│  $43,250.50                      │
│  ┌────────────────────────────┐  │
│  │ 24h: +1.23% ↑              │  │
│  └────────────────────────────┘  │
│                                   │
│  Vol: $23.4B  MCap: $846.2B      │
└──────────────────────────────────┘
```

**Color System:**

```typescript
const colors = {
  // Price changes
  priceUp: 'text-green-600 dark:text-green-400',
  priceDown: 'text-red-600 dark:text-red-400',
  priceNeutral: 'text-gray-600 dark:text-gray-400',
  
  // Backgrounds
  cardBg: 'bg-white dark:bg-gray-800',
  cardBorder: 'border-gray-200 dark:border-gray-700',
  
  // Text
  primary: 'text-gray-900 dark:text-gray-100',
  secondary: 'text-gray-600 dark:text-gray-400',
};
```

---

#### 3.4.3 State Management Strategy

**State Architecture:**

```typescript
// Root layout state (shared across app)
interface RootState {
  currency: 'usd' | 'krw';
  setCurrency: (currency: 'usd' | 'krw') => void;
}

// Home page state (local)
interface HomePageState {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

// Context provider
const CurrencyContext = createContext<RootState | null>(null);

// Usage
export function RootLayout({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<'usd' | 'krw'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('preferred-currency') as 'usd' | 'krw') || 'usd';
    }
    return 'usd';
  });
  
  return (
    <CurrencyContext.Provider value={{ currency, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  );
}
```

**SWR Configuration:**

```typescript
// File: lib/hooks/useCoinPrices.ts

export function useCoinPrices(currency: 'usd' | 'krw') {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/coins/${currency}`,
    () => coinGeckoClient.getMarketData(currency),
    {
      refreshInterval: 10000,          // 10 seconds
      revalidateOnFocus: true,         // Refresh on window focus
      revalidateOnReconnect: true,     // Refresh on reconnect
      dedupingInterval: 5000,          // Prevent duplicate requests within 5s
      errorRetryCount: 3,              // Retry 3 times on error
      errorRetryInterval: 5000,        // Wait 5s between retries
      shouldRetryOnError: true,        // Enable retry
      keepPreviousData: true,          // Show stale data while revalidating
    }
  );
  
  return {
    coins: data,
    isLoading,
    isError: !!error,
    error,
    refresh: mutate,
  };
}
```

---

#### 3.4.4 User Interaction Flows

**Flow 1: Initial Page Load**

```
1. User navigates to app
2. SSR renders initial HTML with skeleton
3. Client hydrates React components
4. SWR fetches coin data (background)
5. Loading skeleton displays
6. Data arrives → Coin cards render
7. Auto-refresh starts (10s interval)
```

**Flow 2: Search Interaction**

```
1. User focuses search input
2. User types "bit"
3. Search query updates (no debounce)
4. CoinList filters coins instantly
5. UI shows only matching coins (Bitcoin)
6. User clears search
7. All coins display again
```

**Flow 3: Currency Toggle**

```
1. User clicks "KRW" button
2. Currency state updates
3. SWR cache key changes
4. New API request triggers (if not cached)
5. All prices re-render in KRW
6. Preference saved to localStorage
```

**Flow 4: Auto-Refresh Cycle**

```
1. 10 seconds elapse since last fetch
2. SWR triggers revalidation
3. API request sent (background)
4. UI shows subtle loading indicator
5. New data arrives
6. Prices update smoothly (no flicker)
7. Cycle repeats
```

---

#### 3.4.5 Responsive Design Breakpoints

```typescript
// Tailwind breakpoints
const breakpoints = {
  sm: '640px',   // Mobile landscape
  md: '768px',   // Tablet
  lg: '1024px',  // Desktop
  xl: '1280px',  // Large desktop
  '2xl': '1536px', // Extra large
};

// Grid layout by breakpoint
const gridLayout = {
  sm: 'grid-cols-1',      // 1 column
  md: 'md:grid-cols-2',   // 2 columns
  lg: 'lg:grid-cols-3',   // 3 columns
  xl: 'xl:grid-cols-4',   // 4 columns
};
```

---

#### 3.4.6 Accessibility Requirements

**WCAG 2.1 Level AA Compliance:**

- **Keyboard Navigation:** All interactive elements accessible via keyboard
- **Screen Reader Support:** Proper ARIA labels and roles
- **Color Contrast:** Minimum 4.5:1 for text, 3:1 for UI components
- **Focus Indicators:** Visible focus states on all interactive elements
- **Alt Text:** Descriptive alt text for coin logos

**Implementation:**

```typescript
// SearchBar accessibility
<input
  type="search"
  role="searchbox"
  aria-label="Search cryptocurrencies"
  aria-describedby="search-hint"
  autoComplete="off"
/>

// CoinCard accessibility
<article
  role="article"
  aria-label={`${coin.name} price information`}
  tabIndex={0}
>
  <img 
    src={coin.image} 
    alt={`${coin.name} logo`}
    loading="lazy"
  />
</article>

// Price change accessibility
<span
  className={priceChangeColor}
  aria-label={`Price change: ${coin.price_change_percentage_24h > 0 ? 'up' : 'down'} ${Math.abs(coin.price_change_percentage_24h)}%`}
>
  {coin.price_change_percentage_24h > 0 ? '↑' : '↓'} 
  {Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
</span>
```

---

## 4. Technical Decisions

### 4.1 Technology Stack

#### 4.1.1 Core Technologies

**Next.js 14.x (App Router)**

**Justification:**
- Server-Side Rendering (SSR) for better SEO and initial load performance
- Built-in routing and file-based structure
- API routes for potential backend needs
- Excellent TypeScript support
- Automatic code splitting and optimization
- Mature ecosystem and active development

**Alternatives Considered:**
- **Vite + React:** Faster dev builds but lacks SSR out of the box
- **Create React App:** Deprecated and less feature-rich
- **Remix:** Good SSR but smaller ecosystem

---

**TypeScript 5.x**

**Justification:**
- Type safety reduces runtime errors
- Better IDE support and autocomplete
- Self-documenting code through types
- Required for production-grade applications
- Excellent integration with React and Next.js

**Configuration:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "paths": {
      "@/*": ["./*"],
      "@/components/*": ["./components/*"],
      "@/lib/*": ["./lib/*"]
    }
  }
}
```

---

**TailwindCSS 3.x**

**Justification:**
- Utility-first approach speeds up development
- Excellent responsive design support
- Built-in dark mode support
- Minimal CSS bundle size (purged unused classes)
- No CSS naming conflicts
- Great documentation and community

**Configuration:**

```javascript
// tailwind.config.js
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'price-up': '#10b981',   // green-500
        'price-down': '#ef4444',  // red-500
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
};
```

---

**SWR (stale-while-revalidate)**

**Justification:**
- Purpose-built for data fetching and caching
- Built-in request deduplication
- Automatic revalidation on interval/focus/reconnect
- Optimistic UI updates
- Smaller bundle size than React Query
- Created by Vercel (Next.js team)

**Alternatives Considered:**
- **React Query:** More features but heavier
- **Plain fetch + useState:** Too much boilerplate
- **Redux Toolkit Query:** Overkill for this use case

---

#### 4.1.2 Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x LTS | Runtime environment |
| pnpm | 8.x | Package manager (faster than npm) |
| ESLint | 8.x | Code linting |
| Prettier | 3.x | Code formatting |
| Husky | 9.x | Git hooks |

---

#### 4.1.3 Third-Party Libraries

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "swr": "^2.2.0",
    "typescript": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.50.0",
    "eslint-config-next": "^14.0.0",
    "postcss": "^8.4.0",
    "prettier": "^3.0.0",
    "tailwindcss": "^3.4.0"
  }
}
```

---

### 4.2 Design Patterns

#### 4.2.1 Architectural Patterns

**Component Composition Pattern**

```typescript
// Container/Presentation pattern
// Container: Handles logic and data
export function CoinListContainer({ currency }: { currency: 'usd' | 'krw' }) {
  const { coins, isLoading, error } = useCoinPrices(currency);
  
  if (isLoading) return <CoinListSkeleton />;
  if (error) return <ErrorDisplay error={error} />;
  
  return <CoinListPresentation coins={coins} currency={currency} />;
}

// Presentation: Pure UI rendering
function CoinListPresentation({ coins, currency }: CoinListProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {coins.map(coin => (
        <CoinCard key={coin.id} coin={coin} currency={currency} />
      ))}
    </div>
  );
}
```

**Custom Hooks Pattern**

```typescript
// Encapsulate complex logic in reusable hooks
export function useCurrency() {
  const context = useContext(CurrencyContext);
  
  if (!context) {
    throw new Error('useCurrency must be used within CurrencyProvider');
  }
  
  return context;
}

export function useSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  // If we need debouncing in the future
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  
  return { query, setQuery, debouncedQuery };
}
```

---

#### 4.2.2 Code Patterns

**Error Boundary Pattern**

```typescript
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h2>Something went wrong</h2>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    
    return this.props.children;
  }
}
```

**Factory Pattern for API Clients**

```typescript
// Factory for creating configured API clients
class APIClientFactory {
  static createCoinGeckoClient(): CoinGeckoClient {
    return new CoinGeckoClient({
      baseURL: process.env.NEXT_PUBLIC_COINGECKO_API_URL || 
               'https://api.coingecko.com/api/v3',
      timeout: 10000,
      rateLimiter: new RateLimiter({
        maxRequests: 10,
        windowMs: 60000,
      }),
    });
  }
}

// Usage
export const coinGeckoClient = APIClientFactory.createCoinGeckoClient();
```

---

## 5. Non-Functional Requirements

### 5.1 Performance

#### 5.1.1 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| First Contentful Paint (FCP) | < 1.5s | Lighthouse |
| Largest Contentful Paint (LCP) | < 2.5s | Lighthouse |
| Time to Interactive (TTI) | < 3.5s | Lighthouse |
| Cumulative Layout Shift (CLS) | < 0.1 | Lighthouse |
| API Response Time | < 2s | Network tab |
| Auto-refresh Impact | No UI flicker | Visual test |

---

#### 5.1.2 Scalability Approach

**Horizontal Scalability:**
- Deploy to edge network (Vercel Edge Functions)
- CDN for static assets
- Client-side caching reduces server load

**Data Optimization:**
- Fetch only required fields from CoinGecko API
- Compress API responses (gzip/brotli)
- Lazy load images with Next.js Image component

**Code Splitting:**

```typescript
// Dynamic imports for heavy components
const CoinChart = dynamic(() => import('@/components/CoinChart'), {
  loading: () => <Skeleton />,
  ssr: false, // Client-side only
});
```

---

#### 5.1.3 Caching Strategy

**Multi-Layer Caching:**

```
┌─────────────────────────────────────────────┐
│  Browser Cache (Service Worker - Future)    │ ← 5 minutes
├─────────────────────────────────────────────┤
│  SWR In-Memory Cache                        │ ← 60 seconds
├─────────────────────────────────────────────┤
│  HTTP Cache (CDN)                           │ ← 30 seconds
├─────────────────────────────────────────────┤
│  CoinGecko API                              │
└─────────────────────────────────────────────┘
```

**Cache Configuration:**

```typescript
// SWR cache settings
const swrConfig = {
  dedupingInterval: 5000,     // Dedupe requests within 5s
  focusThrottleInterval: 10000, // Throttle focus revalidation to 10s
  errorRetryInterval: 5000,   // Retry every 5s on error
};

// HTTP cache headers (if using Next.js API routes)
export async function GET(request: Request) {
  const data = await fetchCoinData();
  
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
}
```

---

#### 5.1.4 Database Query Optimization

**Not Applicable:** This application does not use a database. All data is fetched from CoinGecko API and cached in-memory.

**Future Consideration:** If database added for user watchlists:
- Use PostgreSQL with proper indexes on user_id and coin_id
- Implement connection pooling
- Use read replicas for scaling

---

### 5.2 Security

#### 5.2.1 Authentication and Authorization

**Current (MVP):** No authentication required - public read-only data

**Future Enhancement:**

```typescript
// JWT-based authentication for user features
interface AuthConfig {
  provider: 'clerk' | 'nextauth'; // Recommended providers
  sessionDuration: '7d';
  refreshTokenRotation: true;
}

// Protected API routes
export async function POST(request: Request) {
  const session = await getServerSession();
  
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Handle authenticated request
}
```

---

#### 5.2.2 Data Protection

**API Key Security:**

```typescript
// Environment variables
// .env.local (never committed)
NEXT_PUBLIC_COINGECKO_API_URL=https://api.coingecko.com/api/v3

// Note: CoinGecko free tier doesn't require API key
// If using Pro tier:
COINGECKO_API_KEY=your_key_here // Server-side only
```

**HTTPS Enforcement:**

```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};
```

---

#### 5.2.3 Input Validation

**Search Query Sanitization:**

```typescript
function sanitizeSearchInput(input: string): string {
  return input
    .trim()
    .replace(/[<>\"'&]/g, '') // Remove HTML/script characters
    .slice(0, 50); // Max length
}

// Usage in component
function SearchBar({ value, onChange }: SearchBarProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeSearchInput(e.target.value);
    onChange(sanitized);
  };
  
  return <input value={value} onChange={handleChange} />;
}
```

**API Response Validation:**

```typescript
import { z } from 'zod'; // Runtime validation library

const CoinDataSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  current_price: z.number().nonnegative(),
  price_change_percentage_24h: z.number(),
  image: z.string().url(),
});

function validateCoinData(data: unknown): CoinData {
  return CoinDataSchema.parse(data);
}
```

---

#### 5.2.4 Security Headers

```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};
```

---

### 5.3 Reliability & Availability

#### 5.3.1 Uptime Targets

**Service Level Agreement (SLA):**
- **Target Uptime:** 99.5% (MVP) → 99.9% (Production)
- **Maximum Downtime:** 3.65 hours/month (MVP) → 43.2 minutes/month (Prod)

**Monitoring:**
- Vercel Analytics for performance tracking
- Sentry for error tracking (future)
- UptimeRobot for availability monitoring (future)

---

#### 5.3.2 Fault Tolerance

**API Failure Handling:**

```typescript
function useCoinPricesWithFallback(currency: 'usd' | 'krw') {
  const { data, error } = useSWR(
    `/api/coins/${currency}`,
    fetcher,
    {
      fallbackData: getCachedData(currency), // Use last known good data
      shouldRetryOnError: true,
      errorRetryCount: 3,
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        // Don't retry on 404 or 403
        if (error.status === 404 || error.status === 403) return;
        
        // Exponential backoff
        setTimeout(() => revalidate({ retryCount }), 1000 * Math.pow(2, retryCount));
      },
    }
  );
  
  return { data, error };
}
```

**Graceful Degradation:**

```typescript
// Show cached data with warning
if (error && data) {
  return (
    <>
      <WarningBanner message="Using cached data - Live prices unavailable" />
      <CoinList coins={data} isStale={true} />
    </>
  );
}

// Show error state with retry
if (error && !data) {
  return <ErrorState onRetry={mutate} />;
}
```

---

#### 5.3.3 Backup and Recovery

**Not Applicable for MVP:** No user data to backup

**Future State (with user features):**
- Daily database backups to S3
- Point-in-time recovery capability
- Backup retention: 30 days

---

#### 5.3.4 Monitoring and Alerting

**Metrics to Monitor:**

```typescript
interface MonitoringMetrics {
  // Performance
  apiResponseTime: number;        // p50, p95, p99
  pageLoadTime: number;           // FCP, LCP
  
  // Reliability
  apiErrorRate: number;           // Errors per minute
  apiSuccessRate: number;         // Percentage
  
  // Usage
  activeUsers: number;            // Concurrent users
  requestsPerMinute: number;      // API calls
  
  // Business
  searchesPerDay: number;         // Feature usage
  popularCoins: string[];         // Most viewed
}
```

**Alert Conditions:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| API Down | Error rate > 50% for 5 minutes | Critical |
| Slow Response | API p95 > 5s | Warning |
| Rate Limit Hit | 429 errors detected | Warning |
| High Error Rate | Error rate > 10% | High |

---

## 6. Implementation Considerations

### 6.1 Development Workflow

#### 6.1.1 Repository Structure

```
coinwatcher/
├── .github/
│   └── workflows/
│       ├── ci.yml           # CI pipeline
│       └── deploy.yml       # Deployment workflow
├── app/
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Home page
│   ├── error.tsx            # Error page
│   └── loading.tsx          # Loading page
├── components/
│   ├── CoinList/
│   │   ├── CoinList.tsx
│   │   ├── CoinCard.tsx
│   │   └── CoinListSkeleton.tsx
│   ├── SearchBar/
│   │   └── SearchBar.tsx
│   ├── CurrencyToggle/
│   │   └── CurrencyToggle.tsx
│   └── shared/
│       ├── ErrorBoundary.tsx
│       └── LoadingSpinner.tsx
├── lib/
│   ├── api/
│   │   ├── coinGeckoClient.ts
│   │   └── types.ts
│   ├── hooks/
│   │   ├── useCoinPrices.ts
│   │   └── useCurrency.ts
│   └── utils/
│       ├── formatters.ts
│       ├── rateLimiter.ts
│       └── validation.ts
├── public/
│   ├── favicon.ico
│   └── images/
├── styles/
│   └── globals.css
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── next.config.js
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

#### 6.1.2 Branching Strategy

**Trunk-Based Development (Simplified Git Flow)**

```
main (production)
  ↑
  └── feature/* (short-lived)
      ├── feature/search-bar
      ├── feature/currency-toggle
      └── feature/auto-refresh
```

**Branch Naming Convention:**

- `feature/*` - New features
- `fix/*` - Bug fixes
- `refactor/*` - Code improvements
- `docs/*` - Documentation updates

**Workflow:**

1. Create feature branch from `main`
2. Develop and commit frequently
3. Open Pull Request
4. Code review + automated checks
5. Merge to `main` via squash commit
6. Automatic deployment to production

---

#### 6.1.3 Code Review Process

**Review Checklist:**

```markdown
## Code Review Checklist

### Functionality
- [ ] Feature works as described in requirements
- [ ] Edge cases handled properly
- [ ] Error states implemented

### Code Quality
- [ ] TypeScript types defined correctly
- [ ] No eslint warnings or errors
- [ ] Code follows project conventions
- [ ] No unnecessary complexity

### Performance
- [ ] No unnecessary re-renders
- [ ] Proper memoization if needed
- [ ] Images optimized
- [ ] Bundle size impact minimal

### Testing
- [ ] Unit tests added/updated
- [ ] Tests pass locally
- [ ] Coverage maintained or improved

### Documentation
- [ ] README updated if needed
- [ ] JSDoc comments for complex logic
- [ ] Type definitions documented
```

**Approval Requirements:**
- Minimum 1 approval required
- All CI checks must pass
- No merge conflicts

---

#### 6.1.4 Testing Strategy

**Testing Pyramid:**

```
    ┌─────────────┐
    │ E2E (5%)    │  ← Playwright
    ├─────────────┤
    │ Integration │  ← React Testing Library
    │   (25%)     │
    ├─────────────┤
    │   Unit      │  ← Jest + RTL
    │   (70%)     │
    └─────────────┘
```

**Unit Tests Example:**

```typescript
// tests/unit/lib/utils/formatters.test.ts
import { formatPrice, formatPercentage } from '@/lib/utils/formatters';

describe('formatPrice', () => {
  it('formats USD prices correctly', () => {
    expect(formatPrice(1234.56, 'usd')).toBe('$1,234.56');
    expect(formatPrice(0.123456, 'usd')).toBe('$0.123');
  });
  
  it('formats KRW prices correctly', () => {
    expect(formatPrice(1234567, 'krw')).toBe('₩1,234,567');
  });
  
  it('handles edge cases', () => {
    expect(formatPrice(0, 'usd')).toBe('$0.00');
    expect(formatPrice(-100, 'usd')).toBe('-$100.00');
  });
});
```

**Integration Tests Example:**

```typescript
// tests/integration/components/CoinList.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { CoinList } from '@/components/CoinList/CoinList';

describe('CoinList', () => {
  it('displays coins after loading', async () => {
    const mockCoins = [
      { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', current_price: 43250 },
    ];
    
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CoinList searchQuery="" currency="usd" />
      </SWRConfig>
    );
    
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    });
  });
});
```

**E2E Tests Example:**

```typescript
// tests/e2e/search.spec.ts
import { test, expect } from '@playwright/test';

test('search filters coins correctly', async ({ page }) => {
  await page.goto('/');
  
  // Wait for coins to load
  await page.waitForSelector('[data-testid="coin-card"]');
  
  // Count initial coins
  const initialCount = await page.locator('[data-testid="coin-card"]').count();
  expect(initialCount).toBeGreaterThan(0);
  
  // Search for Bitcoin
  await page.fill('[data-testid="search-input"]', 'bitcoin');
  
  // Should show only Bitcoin
  await expect(page.locator('[data-testid="coin-card"]')).toHaveCount(1);
  await expect(page.locator('text=Bitcoin')).toBeVisible();
});
```

**Test Commands