---
# infer.md — this intent's inference criterion. The BODY below is rendered
# into the agent's Intent Catalog every turn: write it as a trigger condition
# ("applies when ..."), not a summary. Frontmatter allows two optional keys:
#   clarify: <bool>    # false = turns under this intent never ask blocking questions
#   outcomes: [..]     # 2-5 kebab-case ids — a judgment intent's verdict vocabulary
clarify: false
---
Inspecting pipelines without changing them: explaining what a pipeline does and when it fires, checking a definition against the agents it runs, or diagnosing why a draft will not save.
