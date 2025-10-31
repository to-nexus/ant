━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐹 GOLANG PROJECT SETUP - CRITICAL CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 1. go.mod ⭐

**EXAMPLE:**
```go
module github.com/username/project-name

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/gorilla/mux v1.8.0
    gorm.io/gorm v1.25.0
    gorm.io/driver/postgres v1.5.0
)

require (
    // Indirect dependencies are auto-managed by go mod tidy
)
```

**CRITICAL POINTS:**
- Module path must be importable (github.com/user/repo or domain/path)
- Go version should match design document
- Dependencies are added automatically via `go get` or manually
- Run `go mod tidy` to clean up

## 2. Project Structure

**STANDARD LAYOUT:**
```
project/
├── go.mod
├── go.sum (auto-generated)
├── main.go
├── cmd/
│   └── api/
│       └── main.go
├── internal/
│   ├── handlers/
│   ├── models/
│   ├── repository/
│   └── services/
├── pkg/
│   └── utils/
├── configs/
│   └── config.yaml
└── README.md
```

## 3. main.go (Entry Point)

**EXAMPLE** (for HTTP API):
```go
package main

import (
    "log"
    "net/http"
    
    "github.com/gin-gonic/gin"
)

func main() {
    router := gin.Default()
    
    router.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "status": "healthy",
        })
    })
    
    if err := router.Run(":8080"); err != nil {
        log.Fatal("Failed to start server:", err)
    }
}
```

## 4. Makefile (Optional but Recommended)

```makefile
.PHONY: build run test clean

build:
	go build -o bin/app cmd/api/main.go

run:
	go run cmd/api/main.go

test:
	go test -v ./...

test-coverage:
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out

clean:
	rm -rf bin/
	go clean

deps:
	go mod download
	go mod tidy

lint:
	golangci-lint run

format:
	gofmt -w .
	goimports -w .
```

## 5. Configuration Files

### config.yaml (or config.json)
```yaml
server:
  port: 8080
  host: "0.0.0.0"

database:
  host: "localhost"
  port: 5432
  user: "dbuser"
  password: "${DB_PASSWORD}"
  name: "mydb"

logging:
  level: "info"
  format: "json"
```

### .env
```bash
DB_PASSWORD=secretpassword
API_KEY=yourapikey
ENVIRONMENT=development
```

## 6. Linting Configuration (.golangci.yml)

```yaml
linters:
  enable:
    - gofmt
    - golint
    - govet
    - errcheck
    - staticcheck
    - unused
    - gosimple
    - structcheck
    - varcheck
    - ineffassign
    - deadcode

linters-settings:
  errcheck:
    check-blank: true
  govet:
    check-shadowing: true
```

## 7. .gitignore

```
# Binaries
bin/
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary, built with `go test -c`
*.test

# Output of the go coverage tool
*.out
coverage.html

# Dependency directories
vendor/

# Go workspace file
go.work

# Environment variables
.env
.env.local

# IDE
.idea/
.vscode/
*.swp
*.swo
*~

# OS
.DS_Store
```

## 8. README.md

```markdown
# Project Name

## Setup

1. Install Go 1.21+
2. Clone the repository
3. Install dependencies:
   ```bash
   go mod download
   ```

## Running

### Development
```bash
make run
# or
go run cmd/api/main.go
```

### Build
```bash
make build
./bin/app
```

### Testing
```bash
make test
```

## Project Structure

- `cmd/` - Application entry points
- `internal/` - Private application code
- `pkg/` - Public library code
- `configs/` - Configuration files
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES TO AVOID:**

❌ Forgetting to run `go mod tidy` after adding dependencies
❌ Using invalid module path in go.mod (must be importable)
❌ Putting all code in main.go (use proper package structure)
❌ Not following standard Go project layout
❌ Forgetting to add vendor/ to .gitignore
❌ Not handling errors (every error should be checked)

**GO-SPECIFIC CONVENTIONS:**

✅ Use `internal/` for private packages
✅ Use `pkg/` for public, reusable packages
✅ Entry points go in `cmd/`
✅ Use `gofmt` and `goimports` for formatting
✅ Follow [Effective Go](https://golang.org/doc/effective_go) guidelines
✅ Write tests in `*_test.go` files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

