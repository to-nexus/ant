================================================================================
PHASE 1: PLANNING (Analysis & Strategy)
================================================================================

PROJECT: {{project}}

⚠️  CRITICAL INSTRUCTIONS FOR THIS PHASE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 DO NOT GENERATE ANY CODE OR FILES IN THIS PHASE!

This is the PLANNING phase. You will:
✅ Analyze the requirements
✅ Create a detailed execution strategy
✅ Identify which files to create/modify
✅ Specify what changes are needed

🚫 You will NOT:
❌ Generate actual code
❌ Create file content
❌ Write implementations
❌ Output any code files (<file> tags)

The actual code generation will happen in the NEXT phase (IMPLEMENTATION).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

================================================================================
🎯 YOUR SPECIFIC TASK (NOT THE ENTIRE PROJECT!)
================================================================================

{{#if currentTask}}
**Task Name**: {{currentTask.name}}
**Task Type**: {{currentTask.type}}
**Description**: {{currentTask.description}}

⚠️  **CRITICAL**: You are working on THIS SPECIFIC TASK ONLY!
- DO NOT try to implement the entire project
- DO NOT create files unrelated to this specific task
- FOCUS ONLY on what is needed for this one task
- Other tasks will handle other parts of the project
{{else}}
**Full Project Scope**: Complete implementation as specified in design document
{{/if}}

{{#if currentCode}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  IMPORTANT: EXISTING FILES IN WORKING DIRECTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The following files ALREADY EXIST and have been completed by previous tasks:

{{currentCode}}

**CRITICAL PLANNING RULES FOR EXISTING FILES:**
✅ These files are ALREADY DONE - do NOT plan to recreate them!
✅ Only plan to MODIFY a file if your current task specifically requires changes to it
✅ For your current task, identify ONLY the NEW files needed or SPECIFIC modifications required
❌ DO NOT plan a "complete project setup" - that's already done!
❌ DO NOT list files that already exist unless you're modifying them for this task

**Planning Strategy:**
1. Look at existing files to understand what's already implemented
2. Identify ONLY what's missing for YOUR SPECIFIC TASK
3. Plan to create ONLY the new files needed for this task
4. If modifying existing files, specify EXACTLY what changes are needed
{{else}}
📋 This is a fresh project - no existing files yet.
{{/if}}

================================================================================
YOUR TASK - SYSTEMATIC ANALYSIS
================================================================================

Follow these steps to create a focused, detailed plan FOR YOUR SPECIFIC TASK ONLY:

