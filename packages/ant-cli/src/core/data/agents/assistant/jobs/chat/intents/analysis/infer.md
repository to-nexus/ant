---
# infer.md — this intent's inference criterion. The BODY below is rendered
# into the agent's Intent Catalog every turn: write it as a trigger condition
# ("applies when ..."), not a summary. Frontmatter allows two optional keys:
#   clarify: <bool>    # false = turns under this intent never ask blocking questions
#   outcomes: [..]     # 2-5 kebab-case ids — a judgment intent's verdict vocabulary
---
Summarizing, extracting from, transforming, or computing over files or data already in the artifact tree.
