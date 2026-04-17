<analysis>
Two files show type errors. The verification budget is exhausted so a
single-batch plan will be force-split into per-file error sub-tasks by
processDiagnosticBatchSplit.
</analysis>

<plan>
{"task":{"id":"final-verification","goal":"fix type errors"},"diagnostics":{"totalErrors":2,"rootCauses":[]},"implementation":{"create":[],"modify":[{"target":"codebase/src/a.ts","action":"fix"},{"target":"codebase/src/b.ts","action":"fix"}],"delete":[]}}
</plan>
