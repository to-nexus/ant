/** Block `lsof -ti:<orchestrator-port>` — killing Ant's own port crashes the whole system. */
export function checkOrchestratorPortSafeguard(
  command: string,
  orchestratorPort: string,
): void {
  const killPortPattern = /lsof\s+-ti:(\d+)/;
  const match = command.match(killPortPattern);
  if (!match) return;
  const targetPort = match[1];
  if (targetPort !== orchestratorPort) return;

  const errorMsg = `🚨 BLOCKED: Cannot kill port ${orchestratorPort} (Ant orchestrator)

Killing this port crashes the entire Ant system.

CORRECT approach to restart YOUR server:

1. Just run your server (don't kill preemptively)

2. If EADDRINUSE error:
   run_command("pwd")  → Get YOUR project path
   run_command("ps aux | grep '<project-name>'")  → Find YOUR process

3. Kill by YOUR project path (NOT port number):
   run_command("pkill -f '<workspaces-path>/<project>'")

   ✅ Matches YOUR project path: /workspaces/.../project-name/
   ❌ NEVER match: /ant/packages/ant-cli/ (orchestrator)

4. Retry starting server

Rule: Identify processes by PATH, not port numbers.
Port ${orchestratorPort} is the orchestrator. Any process in /ant/packages/ant-cli/ is orchestrator.`;

  console.error(`\n❌ [SAFEGUARD] ${errorMsg}\n`);
  throw new Error(errorMsg);
}
