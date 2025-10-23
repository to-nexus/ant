import { storeMemory, queryMemory } from './index';

async function testMemory() {
  // 1. 단일 문자열 저장 테스트
  console.log("1. Testing single document storage...");
  const testData = "This is a test document for vector storage";
  await storeMemory(testData, "test_namespace", { type: "test", timestamp: new Date().toISOString() });
  
  // 2. 배열 형태 저장 테스트
  console.log("\n2. Testing array of documents storage...");
  const testChunks = [
    {
      content: JSON.stringify({
        path: "/test/file1.ts",
        imports: ["react"],
        exports: ["Component1"],
        type: "codebase_structure"
      }),
      metadata: {
        path: "/test/file1.ts",
        type: "codebase_structure",
        timestamp: new Date().toISOString()
      }
    }
  ];
  await storeMemory(testChunks, "test_namespace_chunks", { type: "batch_store", timestamp: new Date().toISOString() });

  // 3. 검색 테스트
  console.log("\n3. Testing queries...");
  const result1 = await queryMemory("test document storage", "test_namespace");
  const result2 = await queryMemory("react component", "test_namespace_chunks");
  
  console.log("\nQuery Results:");
  console.log("- Simple document:", result1);
  console.log("- Codebase chunk:", result2);
}

testMemory().catch(console.error);
