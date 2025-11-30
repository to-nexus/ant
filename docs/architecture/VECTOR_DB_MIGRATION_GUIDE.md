# Vector DB Migration Guide

## 🎯 Migration Overview

**Old Structure** (Single Collection):
```
Collection: "{project}"
├─ type: 'codebase'
├─ type: 'lesson'
└─ (mixed documents)
```

**New Structure** (Multi-Collection):
```
Collection: "codebase-{project}"
├─ Source code chunks

Collection: "lessons-{project}"
├─ Problem-solution-outcome lessons

Collection: "documents-{project}"
├─ Design docs
├─ PRD
└─ Directives
```

---

## 🔄 Migration Strategy

### Option 1: Clean Start (권장 - 빠르고 안전)

```bash
# 1. Stop the server
# (Ctrl+C or kill the process)

# 2. Clear ChromaDB data
rm -rf /path/to/chroma/data/*

# 3. Restart server
cd /Users/probe/dev/ant/packages/ant-cli
npm run start

# 4. Re-index all projects
# Projects will be automatically re-indexed on next use, or manually:
# ant learn [project]
```

**ChromaDB 데이터 위치**:
- Default: `./chroma_data/` (프로젝트 루트)
- 또는 환경변수 `CHROMA_PATH`에 지정된 경로

**장점**:
- 간단하고 안전
- 데이터 손실 없음 (소스코드로부터 재생성)
- 새로운 구조로 깔끔하게 시작

**단점**:
- 첫 실행 시 재인덱싱 필요 (시간 소요)

---

### Option 2: Gradual Migration (복잡 - 권장하지 않음)

기존 데이터를 유지하면서 점진적으로 마이그레이션:

```typescript
// Migration script (참고용 - 실제 구현 불필요)
async function migrateToMultiCollection(project: string) {
  const oldCollection = await client.getCollection(project);
  const docs = await oldCollection.get();
  
  // Group by type
  const codeChunks = docs.filter(d => d.metadata.type === 'codebase');
  const lessons = docs.filter(d => d.metadata.type === 'lesson');
  
  // Store to new collections
  await vectorDB.store(codeChunks, project, 'codebase');
  await vectorDB.store(lessons, project, 'lessons');
  
  // Delete old collection
  await client.deleteCollection(project);
}
```

**권장하지 않는 이유**:
- 복잡하고 에러 가능성 높음
- Old lesson format이 새 format과 호환되지 않음
- Clean start가 더 안전하고 빠름

---

## 📋 Migration Checklist

### Before Migration

- [ ] 모든 프로젝트 백업 (optional - Git이 있으므로 필요 없음)
- [ ] 현재 실행 중인 작업 완료
- [ ] Server 종료

### During Migration

- [ ] ChromaDB 데이터 디렉토리 삭제
- [ ] Server 재시작
- [ ] 로그 확인 (에러 없는지)

### After Migration

- [ ] 테스트 프로젝트로 검증
  - [ ] Code job 실행
  - [ ] Lesson 저장 확인
  - [ ] Vector search 작동 확인
- [ ] 모든 프로젝트 재인덱싱
  - [ ] `ant learn [project]` 실행
  - [ ] 또는 push 시 자동 인덱싱 대기

---

## 🧪 Testing

### Test 1: 기본 인덱싱

```bash
cd /Users/probe/dev/ant/packages/ant-cli
npm run start &

# Wait for server to start

# Test codebase indexing
curl -X POST http://localhost:4100/api/index \
  -H "Content-Type: application/json" \
  -H "x-user-email: probe@to.nexus" \
  -d '{"project": "test-project"}'
```

**Expected**: 
- ✅ Logs show "Stored N documents to codebase-test-project"
- ✅ No errors

### Test 2: Code Job with Lessons

```bash
# Run a code job
ant code -p test-project -i "Add a new component"
```

**Expected**:
- ✅ Code generated
- ✅ Lesson stored to lessons-test-project
- ✅ Lesson format is problem-solution-outcome
- ✅ No OOM errors

### Test 3: Verify Collections

Check ChromaDB collections:

```bash
# List all collections (requires ChromaDB client)
curl http://localhost:8000/api/v1/collections
```

**Expected collections**:
```json
[
  "codebase-test-project",
  "lessons-test-project"
]
```

---

## 🐛 Troubleshooting

### Issue: "Collection not found" error

**Solution**: 
- Collection is created automatically on first use
- Just run a code job or manual indexing

### Issue: Old format lessons in results

**Solution**:
- Clear ChromaDB data completely
- Restart server
- Re-index

### Issue: OOM during migration

**Solution**:
- Migration strategy already handles this
- New lesson format is much smaller
- If still occurs, check `learn.ts` changes

### Issue: Search returns empty results

**Solution**:
- Verify collections exist: `curl http://localhost:8000/api/v1/collections`
- Verify data in collections
- Re-index if needed

---

## ✅ Rollback Plan

If migration fails:

```bash
# 1. Stop server

# 2. Restore old code
git checkout <previous-commit>

# 3. Restore ChromaDB data (if backed up)
cp -r /backup/chroma_data /path/to/chroma/

# 4. Restart server
npm run start
```

**Note**: Rollback is rarely needed - clean start is safest.

---

## 🚀 Post-Migration Optimization

### 1. Batch Re-indexing

Re-index all projects efficiently:

```bash
# List all projects
ls /Users/probe/dev/ant/workspaces/to.nexus/probe/

# Index each
for project in ant-pong-fe ant-pong-be ant-pinball; do
  echo "Indexing $project..."
  ant learn $project
done
```

### 2. Monitor Performance

Check indexing stats:
- Files indexed
- Chunks created
- Time taken
- Memory usage

### 3. Verify Lesson Quality

Check a few lessons manually:
```bash
# Query lessons from ChromaDB
curl -X POST http://localhost:8000/api/v1/collections/lessons-ant-pong-fe/query \
  -H "Content-Type: application/json" \
  -d '{"query_texts": ["authentication"], "n_results": 2}'
```

**Expected**:
- Lesson has clear problem/solution/outcome
- No full design doc content
- Size < 2KB per lesson

---

## 📊 Success Metrics

Migration is successful if:

- ✅ All collections created with correct naming
- ✅ Code jobs work without errors
- ✅ Lessons stored in new format
- ✅ No OOM errors
- ✅ Search results are relevant
- ✅ Performance is good (< 2s for retrieval)

---

## 🎓 Summary

**Recommended Migration Path**:
1. Stop server
2. Delete ChromaDB data: `rm -rf ./chroma_data/*`
3. Restart server: `npm run start`
4. Re-index projects: `ant learn [project]` or wait for auto-indexing

**Time Estimate**:
- Migration: < 1 minute
- Re-indexing per project: 1-5 minutes (depending on size)
- Total: 5-20 minutes for all projects

**Risk Level**: ⬇️ Low
- No data loss (everything regenerated from source)
- Can rollback easily
- Clean start ensures consistency

