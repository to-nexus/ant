<analysis>
Tracker reports typecheck and build already passed. Tests need to run next,
but they require a devDependency bump in package.json first.
</analysis>

<plan>
{"task":{"id":"final-verification","goal":"align jsdom with node runtime before running tests"},"diagnostics":{"totalErrors":0,"rootCauses":[]},"implementation":{"create":[],"modify":[{"target":"codebase/package.json","action":"bump jsdom to a version compatible with current node"}],"delete":[]}}
</plan>
