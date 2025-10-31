/**
 * Example usage and test cases for parseResponse
 * 
 * This file demonstrates how to use the parser and serves as documentation.
 * Not an actual test file (would need a test framework).
 */

import { parseResponse, getParserInfo } from './parseResponse';

// ============================================================================
// Example 1: Standard Format
// ============================================================================

const standardFormatExample = `
=== RESPONSE ===
I've created the necessary files for the authentication module.
=== END RESPONSE ===

=== FILE: src/auth/login.ts ===
export function login(username: string, password: string) {
  return authenticate(username, password);
}
=== END FILE ===

=== FILE: src/auth/logout.ts ===
export function logout() {
  clearSession();
}
=== END FILE ===

=== DELETE: src/auth/old-auth.ts ===
`;

const result1 = parseResponse(standardFormatExample);
console.log('Standard Format:');
console.log(`  Response: ${result1.responseSection}`);
console.log(`  Files: ${result1.files.length}`);
console.log(`  Deletes: ${result1.filesToDelete.length}`);

// ============================================================================
// Example 2: XML Format
// ============================================================================

const xmlFormatExample = `
<file path="src/utils/helper.ts">
export function formatDate(date: Date): string {
  return date.toISOString();
}
</file>

<delete path="src/utils/old-helper.ts"/>
`;

const result2 = parseResponse(xmlFormatExample);
console.log('\nXML Format:');
console.log(`  Files: ${result2.files.length}`);
console.log(`  Deletes: ${result2.filesToDelete.length}`);

// ============================================================================
// Example 3: Path+Code Format (new)
// ============================================================================

const pathCodeFormatExample = `
<file_path>src/components/Button.tsx</file_path>
<file_code>
import React from 'react';

export function Button({ onClick, children }) {
  return <button onClick={onClick}>{children}</button>;
}
</file_code>
`;

const result3 = parseResponse(pathCodeFormatExample);
console.log('\nPath+Code Format:');
console.log(`  Files: ${result3.files.length}`);
console.log(`  Content length: ${result3.files[0]?.content.length}`);

// ============================================================================
// Example 4: Mixed Formats (all in one response)
// ============================================================================

const mixedFormatExample = `
=== RESPONSE ===
Here are the changes.
=== END RESPONSE ===

=== FILE: file1.ts ===
const a = 1;
=== END FILE ===

<file path="file2.ts">
const b = 2;
</file>

<file_path>file3.ts</file_path>
<file_code>
const c = 3;
</file_code>
`;

const result4 = parseResponse(mixedFormatExample);
console.log('\nMixed Format:');
console.log(`  Files: ${result4.files.length}`); // Should be 3
console.log(`  Paths: ${result4.files.map(f => f.path).join(', ')}`);

// ============================================================================
// Example 5: Markdown Code Fences (should be cleaned)
// ============================================================================

const markdownFencesExample = `
=== FILE: example.ts ===
\`\`\`typescript
function hello() {
  console.log('Hello');
}
\`\`\`
=== END FILE ===
`;

const result5 = parseResponse(markdownFencesExample);
console.log('\nMarkdown Fences:');
console.log(`  Content starts with: ${result5.files[0]?.content.substring(0, 20)}`);
console.log(`  Should not contain: \`\`\``);

// ============================================================================
// Example 6: Code Output Wrapper
// ============================================================================

const wrappedExample = `
<code_output>
=== FILE: wrapped.ts ===
const wrapped = true;
=== END FILE ===
</code_output>
`;

const result6 = parseResponse(wrappedExample);
console.log('\nCode Output Wrapper:');
console.log(`  Files: ${result6.files.length}`);
console.log(`  Wrapper handled: ${result6.files[0]?.path === 'wrapped.ts'}`);

// ============================================================================
// Debug Info
// ============================================================================

const parserInfo = getParserInfo();
console.log('\nParser Info:');
console.log(`  File parsers: ${parserInfo.fileParsers.join(', ')}`);
console.log(`  Delete parsers: ${parserInfo.deleteParsers.join(', ')}`);
console.log(`  Total formats: ${parserInfo.supportedFormats.files} file, ${parserInfo.supportedFormats.deletes} delete`);

// ============================================================================
// Edge Cases
// ============================================================================

// Empty response
const emptyResult = parseResponse('');
console.log('\nEdge Cases:');
console.log(`  Empty input: ${emptyResult.files.length} files`);

// Duplicate files (later ones should override)
const duplicateExample = `
=== FILE: test.ts ===
version 1
=== END FILE ===

<file path="test.ts">
version 2
</file>
`;

const duplicateResult = parseResponse(duplicateExample);
console.log(`  Duplicate handling: ${duplicateResult.files[0]?.content.includes('version 2')}`);

// No response section
const noResponseExample = `
=== FILE: test.ts ===
content
=== END FILE ===
`;

const noResponseResult = parseResponse(noResponseExample);
console.log(`  No response section: ${noResponseResult.responseSection === null}`);

