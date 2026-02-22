{{{errorText}}}

🚨 CRITICAL INSTRUCTIONS - READ CAREFULLY:

1. FIX ONLY THE ABOVE VALIDATION ERRORS
   - DO NOT regenerate or repeat the original implementation
   - ONLY modify the files necessary to fix these specific errors

2. FOCUS ON ROOT CAUSES:
   - Missing @types/* packages → Add to package.json devDependencies  
   - TypeScript config errors → Update tsconfig.json
   - Import/module errors → Fix import paths or file names
   - Build configuration errors → Update config files

3. OUTPUT FORMAT (MANDATORY):
   
   ⚠️  CHOOSE THE CORRECT FORMAT BASED ON FILE STATUS:
   
   **For EXISTING files** (files already in the codebase):
   <edit path="path/to/file.ext">
   <search>
   [exact code section to find - must match perfectly]
   </search>
   <replace>
   [new code to replace with]
   </replace>
   </edit>
   
   **For NEW files only** (files that don't exist yet):
   <file path="path/to/file.ext">
   [complete file content - write EVERY line]
   </file>
   
   ⚠️  CRITICAL: Use <edit> for modifications, <file> only for new files!

4. ❌ FORBIDDEN - DO NOT USE:
   - NO <file> tags for existing files (use <edit>!)
   - NO markdown code blocks (NO ```tsx, ```typescript, ```json, etc.)
   - NO markdown headers (NO ### FILE:, ## FILE:, etc.)
   - NO explanatory text before/after files
   - NO ellipsis (...) or placeholder comments
   - NO unclosed XML tags
   
5. EXAMPLE OF CORRECT FORMAT (Editing existing package.json):
   
   <edit path="package.json">
   <search>
   {
     "dependencies": {
       "react": "^18.3.1"
     }
   }
   </search>
   <replace>
   {
     "dependencies": {
       "react": "^18.3.1"
     },
     "devDependencies": {
       "@types/react": "^18.0.0",
       "@types/node": "^20.0.0",
       "typescript": "^5.0.0"
     }
   }
   </replace>
   </edit>

6. VALIDATION RULES:
   - <search> block must match existing file content EXACTLY
   - Use <edit> for all existing files (even config files!)
   - Use <file> only if creating a brand new file
   - Include ALL content in <file> blocks (no shortcuts)
   - Check for missing dependencies carefully
   - Close all XML tags properly

7. END WITH SUMMARY (REQUIRED!):
   After all file operations, provide a brief explanation:
   
   Example:
   <edit path="package.json">...</edit>
   
   Fixed the build errors by adding missing type definitions to devDependencies.
   The build should now succeed.

START YOUR RESPONSE WITH THE FIRST EDIT/FILE (<edit path="..." or <file path="...")
