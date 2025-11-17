# 📰 NEXUS Daily Newsletter Generator (Frontend-only PRD)

## 🎯 Goal
A **TypeScript + React** static site project that automatically **generates a daily newsletter** (once every 24 hours) containing:
- Company-related news (`넥써쓰`, `장현국`, `크로쓰 코인`, `크로쓰 토큰`)
- Industry news (blockchain, coin, AI, game topics)

Each article title should be a **clickable link** to the original source.  
All logic runs **at build time**, and the output is a **static HTML page** per day.

---

## 🏗️ Scope
- **Frontend only** (no backend, no server)
- **TypeScript + React**
- Generates **static HTML pages** at build time (e.g., using Next.js Static Generation or Vite + React + prebuild script)
- Each daily newsletter is a **standalone HTML page**
- Build script fetches and categorizes news
- If the last newsletter was generated **within 24 hours**, skip regeneration

---

## 🕒 Build Behavior
1. On build:
   - Check `/public/newsletter/` for the most recent file
   - If the file timestamp is **< 24h**, skip generation
   - Else:
     - Fetch new data from the news API (e.g., Google News, Naver RSS)
     - Categorize and render a new newsletter as HTML
2. Output path:
   ```
   /public/newsletter/YYYY-MM-DD.html
   ```

---

## 🔍 Data Sources & Keywords

### 1. Company-related news
Search for:
- `넥써쓰`
- `장현국`
- `크로쓰 코인`
- `크로쓰 토큰`

Category: **자사 소식 (Company News)**

### 2. Industry-related news
**Blockchain / Coin keywords:**
- `블록체인`, `코인`, `스테이블코인`, `ETF`, `디파이`

**IT / AI / Game keywords:**
- `AI`, `게임`, `지스타`, `오픈AI`, `오락`, `메타버스`

Categories:
- **블록체인**
- **산업(게임/IT)**

---

## 🧩 Functional Requirements

### 1. Fetch & Filter News
- Fetch articles via API or RSS feed (e.g., Naver, Google News)
- Limit results to the **last 24 hours**
- Deduplicate identical titles/links

### 2. Categorization
- Match fetched articles with defined keyword sets
- Assign them to:
  - `자사 소식`
  - `블록체인`
  - `산업(게임/IT)`

### 3. Static Page Generation
- Build-time React rendering into `/public/newsletter/<date>.html`
- Each section shows:
  - Category heading
  - List of clickable article titles with sources

### 4. Build Skipping Logic
- Check if today’s newsletter already exists
- Skip fetch/render if generated within the last 24 hours

---

## 🧠 Non-functional Requirements
- **No backend / cron / database**
- **All logic runs at build time**
- **Static-only output**
- Lightweight dependencies (`axios`, `cheerio`, `date-fns` allowed)
- Deterministic build results
- **Markdown exportable** for email use

---

## 🧱 Suggested Project Structure

```
src/
 ├─ components/
 │   ├─ Layout.tsx
 │   ├─ NewsSection.tsx
 │   ├─ NewsItem.tsx
 │   └─ Footer.tsx
 ├─ lib/
 │   ├─ fetchNews.ts        // fetch and parse news
 │   ├─ categorizeNews.ts   // classify by keyword
 │   └─ saveNewsletter.ts   // write to /public
 ├─ pages/
 │   └─ index.tsx           // list of newsletter links
 └─ scripts/
     └─ generateNewsletter.ts // CLI entry for build process
```

---

## 💄 Example Output (HTML)

```html
<h2>2025. 11. 11</h2>

<h3>자사 소식</h3>
<ul>
  <li><a href="https://www.xportsnews.com/article/12345" target="_blank">넥써쓰, AI·블록체인 결합으로 ‘누구나 만드는 게임’ 시대 연다 (엑스포츠뉴스)</a></li>
  <li><a href="https://sports.hankooki.com/article/67890" target="_blank">지스타 2025, B2B 통한 글로벌 협력 모색 활발 (스포츠한국)</a></li>
</ul>

<h3>블록체인</h3>
<ul>
  <li><a href="https://zdnet.co.kr/news/abc" target="_blank">스테이블코인 정부 법안 이달 중 가닥 (지디넷)</a></li>
  <li><a href="https://digitaltoday.co.kr/news/xyz" target="_blank">테더, 중앙은행처럼 움직인다 (디지털투데이)</a></li>
</ul>

<h3>산업(게임/IT)</h3>
<ul>
  <li><a href="https://dailygame.co.kr/article/ion2" target="_blank">[체험기] 화제작 '아이온2' 첫 인상은? (데일리게임)</a></li>
  <li><a href="https://yna.co.kr/news/aihealth" target="_blank">오픈AI, 헬스케어 분야 진출 검토 (연합뉴스)</a></li>
</ul>
```

---

## ✅ Acceptance Criteria
- [ ] Written in **TypeScript + React**
- [ ] Build-time generation of `/public/newsletter/<date>.html`
- [ ] Each news item links to the **original article**
- [ ] Categorization by keyword sets
- [ ] Skips generation if `<24h` old file exists
- [ ] No backend or API routes required