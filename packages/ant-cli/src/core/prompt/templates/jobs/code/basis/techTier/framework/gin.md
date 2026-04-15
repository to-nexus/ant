# Gin Framework Profile (Go)

## Basic Setup
```go
package main

import (
    "github.com/gin-gonic/gin"
    "net/http"
)

func main() {
    // Create router
    r := gin.Default()  // With Logger and Recovery middleware
    // r := gin.New()   // Without default middleware
    
    // Define routes
    r.GET("/ping", handlePing)
    r.POST("/users", handleCreateUser)
    
    // Start server
    r.Run(":8080")  // Listen on 0.0.0.0:8080
}
```

## Route Handlers
```go
// ✅ Good: Use gin.Context for request/response
func handlePing(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "message": "pong",
    })
}

// ✅ Good: Bind JSON request body
type CreateUserRequest struct {
    Name  string `json:"name" binding:"required"`
    Email string `json:"email" binding:"required,email"`
}

func handleCreateUser(c *gin.Context) {
    var req CreateUserRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    // Create user
    user, err := createUser(req.Name, req.Email)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
        return
    }
    
    c.JSON(http.StatusCreated, user)
}
```

## Routing Patterns
```go
func setupRoutes(r *gin.Engine) {
    // Simple routes
    r.GET("/health", handleHealth)
    
    // Route with path parameters
    r.GET("/users/:id", handleGetUser)
    
    // Query parameters
    r.GET("/search", handleSearch)  // /search?q=golang&page=1
    
    // Route groups
    api := r.Group("/api/v1")
    {
        api.GET("/users", handleListUsers)
        api.POST("/users", handleCreateUser)
        
        // Nested groups
        users := api.Group("/users")
        {
            users.GET("/:id", handleGetUser)
            users.PUT("/:id", handleUpdateUser)
            users.DELETE("/:id", handleDeleteUser)
        }
    }
}
```

## Path and Query Parameters
```go
// ✅ Path parameters
func handleGetUser(c *gin.Context) {
    userID := c.Param("id")  // /users/:id
    
    user, err := getUserByID(userID)
    if err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
        return
    }
    
    c.JSON(http.StatusOK, user)
}

// ✅ Query parameters
func handleSearch(c *gin.Context) {
    query := c.Query("q")                    // /search?q=golang
    page := c.DefaultQuery("page", "1")      // Default value
    limit, _ := strconv.Atoi(c.Query("limit"))  // Convert to int
    
    results := search(query, page, limit)
    c.JSON(http.StatusOK, results)
}
```

## Request Binding and Validation
```go
// ✅ Struct tags for validation
type LoginRequest struct {
    Email    string `json:"email" binding:"required,email"`
    Password string `json:"password" binding:"required,min=8"`
}

func handleLogin(c *gin.Context) {
    var req LoginRequest
    
    // Bind and validate
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    // Proceed with login
    token, err := authenticate(req.Email, req.Password)
    if err != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"token": token})
}
```

## Middleware
```go
// ✅ Custom middleware
func AuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        token := c.GetHeader("Authorization")
        
        if token == "" {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
            c.Abort()  // Stop the chain
            return
        }
        
        userID, err := validateToken(token)
        if err != nil {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
            c.Abort()
            return
        }
        
        // Set value in context
        c.Set("userID", userID)
        
        c.Next()  // Continue to next handler
    }
}

// ✅ Apply middleware
func setupRoutes(r *gin.Engine) {
    // Global middleware
    r.Use(gin.Logger())
    r.Use(gin.Recovery())
    r.Use(CORSMiddleware())
    
    // Group middleware
    api := r.Group("/api/v1")
    api.Use(AuthMiddleware())
    {
        api.GET("/profile", handleGetProfile)
        api.PUT("/profile", handleUpdateProfile)
    }
}
```

## Error Handling
```go
// ✅ Principle: Define a single error response type and a shared handler
// - Struct fields and naming follow the design document's API contract
// - All error responses go through one helper function for consistency

// ✅ Use centralized error handler in routes
func handleGetUser(c *gin.Context) {
    userID := c.Param("id")

    user, err := getUserByID(userID)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            handleError(c, http.StatusNotFound, err)
        } else {
            handleError(c, http.StatusInternalServerError, err)
        }
        return
    }

    c.JSON(http.StatusOK, user)
}
```

## Context Values
```go
// ✅ Set and get values from context
func AuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        userID := extractUserID(c)
        c.Set("userID", userID)  // Set
        c.Next()
    }
}

func handleGetProfile(c *gin.Context) {
    userID, exists := c.Get("userID")  // Get
    if !exists {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
        return
    }
    
    profile, _ := getProfile(userID.(string))
    c.JSON(http.StatusOK, profile)
}
```

## File Uploads
```go
func handleUpload(c *gin.Context) {
    // Single file
    file, err := c.FormFile("file")
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "no file uploaded"})
        return
    }
    
    // Save file
    dst := fmt.Sprintf("./uploads/%s", file.Filename)
    if err := c.SaveUploadedFile(file, dst); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"filename": file.Filename})
}
```

## Response Types
```go
// ✅ JSON response
c.JSON(http.StatusOK, gin.H{"message": "success"})
c.JSON(http.StatusOK, user)

// ✅ String response
c.String(http.StatusOK, "Hello, World!")

// ✅ HTML response
c.HTML(http.StatusOK, "index.html", gin.H{"title": "Home"})

// ✅ Redirect
c.Redirect(http.StatusFound, "/login")

// ✅ File response
c.File("./static/image.png")

// ✅ Stream response
c.Stream(func(w io.Writer) bool {
    // Write to stream
    return true
})
```

## Best Practices
- **Use `gin.Default()`** for standard setup with logging and recovery
- **Group related routes** with `r.Group()`
- **Use middleware** for cross-cutting concerns (auth, logging, CORS)
- **Bind and validate** requests with struct tags
- **Handle errors consistently** with standard response format
- **Use context values** to pass request-scoped data
- **Return early** on errors (avoid deep nesting)
- **Use HTTP status codes** correctly

## Forbidden Patterns
- ❌ Not handling errors in handlers
- ❌ Not validating request data
- ❌ Blocking handlers with long operations (use goroutines)
- ❌ Not using middleware for common logic
- ❌ Returning inconsistent error formats
- ❌ Not using `c.Abort()` in middleware when stopping chain

