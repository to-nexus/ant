## Python Setup Task Constraints

⛔ **CRITICAL: This is a SETUP task - Configuration files ONLY** ⛔

This is PHASE 1 of a multi-phase process. You must generate ONLY configuration files.
Application code will be generated in PHASE 2 (next task).

### ✅ ALLOWED FILES (Configuration & Setup):

**Package Management:**
- requirements.txt
- requirements-dev.txt
- pyproject.toml
- setup.py, setup.cfg (if needed)
- poetry.lock (if using Poetry)
- Pipfile, Pipfile.lock (if using Pipenv)

**Python Configuration:**
- .python-version, .python-env
- pytest.ini, .coveragerc
- mypy.ini, .mypy.ini
- .flake8, .pylintrc
- tox.ini

**Project Files:**
- .gitignore
- .env.example
- README.md, LICENSE
- .editorconfig

**Docker (if needed):**
- Dockerfile, .dockerignore
- docker-compose.yml

**CI/CD:**
- .github/workflows/*.yml

### ❌ FORBIDDEN FILES (Application Code):

**Source Directories - DO NOT CREATE:**
- src/* (ALL files)
- app/* (ALL files)
- lib/* (ALL files)
- {project_name}/* (ALL files - main package)
- tests/* (ALL files)
- scripts/* (ALL files)

**Application Files - DO NOT CREATE:**
- main.py, __main__.py
- app.py, server.py
- manage.py (Django)
- Any .py files (except __init__.py in root if absolutely needed for packaging)
- Any package implementation files

### ⚠️  VALIDATION BEFORE OUTPUT:

Check EVERY file path in your output:
```
For each file:
  if path.startsWith('src/'):   DELETE IT
  if path.startsWith('app/'):   DELETE IT
  if path.startsWith('lib/'):   DELETE IT
  if path.endsWith('.py') and not (path == '__init__.py' or 'setup.py'): DELETE IT
```

### 📌 NOTE:

Python projects need requirements.txt or pyproject.toml first to define dependencies.
All Python source files will be generated in the next Feature task.

⛔ **FINAL WARNING: Generating .py application files will cause validation failure!** ⛔

