━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐍 PYTHON PROJECT SETUP - CRITICAL CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 1. pyproject.toml (Modern Python) ⭐

**EXAMPLE** (for FastAPI project):
```toml
[project]
name = "project-name"
version = "0.1.0"
description = "Project description"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.24.0",
    "pydantic>=2.0.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.12.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-cov>=4.1.0",
    "black>=23.0.0",
    "ruff>=0.1.0",
    "mypy>=1.7.0",
]

[build-system]
requires = ["setuptools>=68.0.0", "wheel"]
build-backend = "setuptools.build_meta"

[tool.black]
line-length = 100
target-version = ['py310']

[tool.ruff]
line-length = 100
select = ["E", "F", "I", "N", "W"]

[tool.mypy]
python_version = "3.10"
strict = true
warn_return_any = true
warn_unused_configs = true

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
```

**ALTERNATIVE:** requirements.txt (simpler projects)
```
fastapi==0.104.0
uvicorn[standard]==0.24.0
pydantic==2.5.0
sqlalchemy==2.0.23
```

**AND** requirements-dev.txt
```
pytest==7.4.3
pytest-cov==4.1.0
black==23.11.0
ruff==0.1.6
mypy==1.7.1
```

## 2. Project Structure

**STANDARD LAYOUT:**
```
project/
├── pyproject.toml (or setup.py)
├── requirements.txt (or both)
├── README.md
├── .env
├── src/
│   └── project_name/
│       ├── __init__.py
│       ├── main.py
│       ├── models/
│       │   ├── __init__.py
│       │   └── user.py
│       ├── routes/
│       │   ├── __init__.py
│       │   └── users.py
│       ├── services/
│       │   ├── __init__.py
│       │   └── user_service.py
│       └── utils/
│           ├── __init__.py
│           └── helpers.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   └── test_users.py
└── .gitignore
```

## 3. main.py (Entry Point)

**EXAMPLE** (FastAPI):
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Project Name",
    description="Project description",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
```

**EXAMPLE** (Django):
```python
# manage.py
#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "project.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed?"
        ) from exc
    execute_from_command_line(sys.argv)
```

## 4. Makefile or scripts (Recommended)

**Makefile:**
```makefile
.PHONY: install dev test lint format clean

install:
	pip install -e ".[dev]"

dev:
	uvicorn src.project_name.main:app --reload --host 0.0.0.0 --port 8000

test:
	pytest -v --cov=src --cov-report=html

lint:
	ruff check .
	mypy src

format:
	black .
	ruff check --fix .

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov
```

## 5. Configuration Files

### .env
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
SECRET_KEY=your-secret-key-here
DEBUG=True
ENVIRONMENT=development
```

### config.py (or settings.py)
```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    database_url: str
    secret_key: str
    debug: bool = False
    environment: str = "production"
    
    class Config:
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

## 6. Testing (pytest)

### conftest.py
```python
import pytest
from fastapi.testclient import TestClient
from src.project_name.main import app

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def db_session():
    # Setup test database
    # ...
    yield session
    # Teardown
```

### test_users.py
```python
def test_read_main(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}
```

## 7. .gitignore

```
# Byte-compiled / optimized / DLL files
__pycache__/
*.py[cod]
*$py.class

# Distribution / packaging
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtual environments
venv/
ENV/
env/
.venv

# Testing
.pytest_cache/
.coverage
htmlcov/
.tox/

# Type checking
.mypy_cache/
.dmypy.json
dmypy.json

# IDE
.idea/
.vscode/
*.swp
*.swo

# Environment
.env
.env.local

# OS
.DS_Store
```

## 8. README.md

```markdown
# Project Name

## Setup

1. Install Python 3.10+
2. Create virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -e ".[dev]"
   # or
   pip install -r requirements.txt -r requirements-dev.txt
   ```

## Running

### Development
```bash
make dev
# or
uvicorn src.project_name.main:app --reload
```

### Testing
```bash
make test
```

### Linting & Formatting
```bash
make format
make lint
```
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES TO AVOID:**

❌ Not using virtual environments (venv, virtualenv, poetry)
❌ Mixing setup.py with pyproject.toml (choose one!)
❌ Forgetting `__init__.py` in packages (Python <3.3 style, but still common)
❌ Not pinning dependency versions in production
❌ Importing from parent packages incorrectly
❌ Not using type hints (modern Python should use them)

**PYTHON-SPECIFIC CONVENTIONS:**

✅ Use `pyproject.toml` for modern projects (PEP 518)
✅ Use `src/` layout to avoid import issues
✅ Use `black` or `ruff` for formatting
✅ Use `mypy` or `pyright` for type checking
✅ Use `pytest` over `unittest`
✅ Follow PEP 8 style guide
✅ Use virtual environments ALWAYS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

