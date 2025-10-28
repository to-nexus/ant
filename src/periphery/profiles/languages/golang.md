# Go Language Profile

## Naming Conventions
- **PascalCase**: Exported identifiers (public)
  - `User`, `FetchData`, `HTTPClient`
- **camelCase**: Unexported identifiers (private)
  - `user`, `fetchData`, `httpClient`
- **ALL_CAPS**: Constants (by convention, but camelCase also acceptable)
  - `MaxRetryCount` or `maxRetryCount`
- **Acronyms**: Keep uppercase in names
  - `HTTPServer`, `URLParser`, `IDGenerator`

## Package Structure
```go
// Package declaration
package main

// Imports (standard library, then third-party, then internal)
import (
    "context"
    "fmt"
    "net/http"
    
    "github.com/gin-gonic/gin"
    
    "myapp/internal/models"
    "myapp/internal/services"
)
```

## Error Handling
- **Always check errors explicitly**
- **Return errors, don't panic** (panic only for unrecoverable errors)
- **Use custom error types** when context is needed
- **Wrap errors with context** using `fmt.Errorf("context: %w", err)`

```go
// ✅ Good: Explicit error handling
func fetchUser(id string) (*User, error) {
    user, err := db.Query("SELECT * FROM users WHERE id = ?", id)
    if err != nil {
        return nil, fmt.Errorf("failed to fetch user %s: %w", id, err)
    }
    
    if user == nil {
        return nil, fmt.Errorf("user %s not found", id)
    }
    
    return user, nil
}
```

## Best Practices
- **Use gofmt/goimports** - formatting is non-negotiable
- **Declare variables close to usage**
- **Prefer short variable names** in small scopes (`i`, `err`, `ctx`)
- **Use meaningful names** in larger scopes
- **Keep functions small and focused**
- **Avoid deeply nested code** - return early
- **Use defer for cleanup** (close files, unlock mutexes)

## Idiomatic Patterns
```go
// ✅ Early return for error cases
func process(data string) error {
    if data == "" {
        return fmt.Errorf("empty data")
    }
    
    result, err := transform(data)
    if err != nil {
        return fmt.Errorf("transform failed: %w", err)
    }
    
    return save(result)
}

// ✅ Use context for cancellation and timeouts
func fetchWithTimeout(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }
    
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    return io.ReadAll(resp.Body)
}
```

## Struct and Interface Design
```go
// ✅ Small, focused interfaces
type Reader interface {
    Read(p []byte) (n int, err error)
}

// ✅ Struct with exported and unexported fields
type User struct {
    ID        string    // Exported
    Name      string    // Exported
    createdAt time.Time // Unexported (private)
}

// ✅ Constructor pattern
func NewUser(id, name string) *User {
    return &User{
        ID:        id,
        Name:      name,
        createdAt: time.Now(),
    }
}
```

## Concurrency
- **Use goroutines for concurrent operations**
- **Use channels for communication** ("share memory by communicating")
- **Use sync.WaitGroup** for waiting on goroutines
- **Use context for cancellation** in long-running operations
- **Avoid data races** - use mutexes or channels

```go
// ✅ Good: Concurrent processing with wait group
func processItems(items []string) error {
    var wg sync.WaitGroup
    errChan := make(chan error, len(items))
    
    for _, item := range items {
        wg.Add(1)
        go func(i string) {
            defer wg.Done()
            if err := process(i); err != nil {
                errChan <- err
            }
        }(item)
    }
    
    wg.Wait()
    close(errChan)
    
    // Check for errors
    for err := range errChan {
        if err != nil {
            return err
        }
    }
    
    return nil
}
```

## Forbidden Patterns
- ❌ Ignoring errors (`_ = someFunc()`)
- ❌ Using panic for normal error handling
- ❌ Not using defer for cleanup
- ❌ Mixing tabs and spaces (use tabs, gofmt enforces this)
- ❌ Global mutable state

