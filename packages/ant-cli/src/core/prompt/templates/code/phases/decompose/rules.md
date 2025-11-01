Return JSON ONLY (no explanation):
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

IMPORTANT:
- **Decide intelligently**: Create setup task ONLY if spec requires new configuration
- If NEW PROJECT: Setup task is typically needed (but analyze the spec!)
- If EXISTING PROJECT: Setup task only if adding new tools/infrastructure
- If the spec only mentions "build a React app" with no specific features → return setup task + empty array for features
- Focus on USER-FACING features, not infrastructure (infrastructure = setup task)
- Each task must have unique id (kebab-case)
- **ALWAYS include the final verification task as the last task**
- **CRITICAL**: You MUST provide validationRequired, validationType, and validationRationale for EVERY task

