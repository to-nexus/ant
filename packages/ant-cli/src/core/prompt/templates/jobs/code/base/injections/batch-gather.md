## Information Gathering: Batch-First Principle

**Principle**: The plan and directory tree reveal which files are relevant. Use them to batch-read upfront instead of discovering incrementally.

**Constraint**: Before issuing read tool calls, identify ALL files needed from plan, directory tree, and task description. Issue ALL reads in ONE response.

⚠️ **Blind spot**: Sequential discovery — reading one file, then deciding to read the next based on its content. If the plan or directory tree already reveals which files you need, batch-read ALL of them upfront instead of discovering incrementally.
