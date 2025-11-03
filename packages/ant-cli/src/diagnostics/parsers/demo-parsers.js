#!/usr/bin/env node

/**
 * Demo script to test error parsers
 * 
 * Run: node demo-parsers.js
 */

import { ErrorParserFactory } from './index.js';

console.log('='.repeat(80));
console.log('ERROR PARSER DEMO');
console.log('='.repeat(80));
console.log();

// Test TypeScript Parser
console.log('📘 TypeScript Parser Demo');
console.log('-'.repeat(80));
const tsOutput = `
src/App.tsx(10,5): error TS2304: Cannot find name 'React'.
src/components/Button.tsx(23,15): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/utils/helpers.ts(45,20): error TS2322: Type 'null' is not assignable to type 'string'.
`.trim();

const tsParser = ErrorParserFactory.create('typescript', { projectRoot: '/test' });
const tsErrors = tsParser.parse(tsOutput);
const tsFormatted = tsParser.format(tsErrors);

console.log(`\nInput:\n${tsOutput}\n`);
console.log(`Parsed ${tsErrors.length} errors:\n`);
tsFormatted.forEach((err, i) => {
  console.log(`${i + 1}. ${err}`);
  console.log();
});

// Test Vite Parser
console.log('\n' + '='.repeat(80));
console.log('⚡ Vite Parser Demo');
console.log('-'.repeat(80));
const viteOutput = `
[vite]: Rollup failed to resolve import "invalid-module" from "src/App.tsx".
[plugin:vite:resolve] Module "path" externalized for browser compatibility. Cannot access "path.join" in client code.
Could not resolve entry module "index.html".
`.trim();

const viteParser = ErrorParserFactory.create('vite', { projectRoot: '/test' });
const viteErrors = viteParser.parse(viteOutput);
const viteFormatted = viteParser.format(viteErrors);

console.log(`\nInput:\n${viteOutput}\n`);
console.log(`Parsed ${viteErrors.length} errors:\n`);
viteFormatted.forEach((err, i) => {
  console.log(`${i + 1}. ${err}`);
  console.log();
});

// Test ESLint Parser
console.log('\n' + '='.repeat(80));
console.log('📋 ESLint Parser Demo');
console.log('-'.repeat(80));
const eslintOutput = `
/path/to/src/App.tsx
  10:5  error  'React' is not defined  no-undef
  23:15  warning  Missing semicolon  semi
  45:20  error  Unexpected console statement  no-console

✖ 3 problems (2 errors, 1 warning)
`.trim();

const eslintParser = ErrorParserFactory.create('eslint', { projectRoot: '/test' });
const eslintErrors = eslintParser.parse(eslintOutput);
const eslintFormatted = eslintParser.format(eslintErrors);

console.log(`\nInput:\n${eslintOutput}\n`);
console.log(`Parsed ${eslintErrors.length} errors:\n`);
eslintFormatted.forEach((err, i) => {
  console.log(`${i + 1}. ${err}`);
  console.log();
});

// Test Auto-detection
console.log('\n' + '='.repeat(80));
console.log('🔍 Auto-detection Demo');
console.log('-'.repeat(80));

const autoDetectSamples = [
  {
    name: 'TypeScript Error',
    output: 'src/App.tsx(10,5): error TS2304: Cannot find name "React".',
  },
  {
    name: 'Vite Error',
    output: '[vite]: Rollup failed to resolve import "something"',
  },
  {
    name: 'ESLint Error',
    output: '/path/to/file.ts\n  10:5  error  message  rule-name',
  },
];

autoDetectSamples.forEach((sample) => {
  console.log(`\n${sample.name}:`);
  const parser = ErrorParserFactory.autoDetect(sample.output, { projectRoot: '/test' });
  const errors = parser.parse(sample.output);
  console.log(`  Detected parser: ${parser.constructor.name}`);
  console.log(`  Parsed errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log(`  First error: ${errors[0].code || 'N/A'} - ${errors[0].message.substring(0, 60)}...`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('✅ Demo Complete');
console.log('='.repeat(80));
