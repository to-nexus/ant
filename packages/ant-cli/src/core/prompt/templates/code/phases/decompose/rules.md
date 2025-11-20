OUTPUT FORMAT:

{{> base/text-response-format}}

First, analyze step by step (think through):
- Is this a new project or existing project?
- Does it need setup/configuration tasks?
- What are the main features to implement?
- What is the optimal task breakdown?
- What validation strategy for each task?

Then output the task list wrapped in <tasks> tags with valid JSON:

<tasks>
{
  "tasks": [
    {
      "id": "setup-docker",
      "name": "Setup Docker Configuration",
      "type": "setup",
      "priority": 100,
      "description": "Generate Dockerfile, docker-compose.yml, .dockerignore",
      "validationRequired": true,
      "validationType": "static",
      "validationRationale": "Config files need syntax validation"
    },
    {
      "id": "auth-impl",
      "name": "Implement User Authentication System",
      "type": "feature",
      "priority": 200,
      "description": "Create login, signup, JWT token handling, protected routes",
      "validationRequired": true,
      "validationType": "runtime",
      "validationRationale": "Critical security feature requires full validation"
    }
  ]
}
</tasks>

CRITICAL: 
- The JSON inside <tasks> tags MUST be valid JSON (no trailing commas, proper quotes)
- Use <tasks> wrapper so the JSON can be reliably extracted

IMPORTANT:
- **Decide intelligently**: Create setup task ONLY if spec requires new configuration
- If NEW PROJECT: Setup task is typically needed (but analyze the spec!)
- If EXISTING PROJECT: Setup task only if adding new tools/infrastructure
- If the spec only mentions "build a React app" with no specific features → return setup task + empty array for features
- Focus on USER-FACING features, not infrastructure (infrastructure = setup task)
- Each task must have unique id (kebab-case)
- **ALWAYS include the final verification task as the last task**
- **CRITICAL**: You MUST provide validationRequired, validationType, and validationRationale for EVERY task

