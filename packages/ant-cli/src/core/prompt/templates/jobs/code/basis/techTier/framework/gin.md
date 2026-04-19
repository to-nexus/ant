# Gin Framework Hints

Blind-spot reminders. Pre-training gap only.

## Forbidden Patterns

- `c.JSON(...)` after `c.Abort()` without `return` → panic or "superfluous response.WriteHeader".
- Capturing `*gin.Context` in a goroutine without `c.Copy()` → original is pool-recycled; reads race.
- `c.ShouldBindJSON(&req)` with `binding:"required"` on a pointer → fails silently for JSON `null`.
- Multiple middleware writing to `c.Writer` before the handler → first write commits the status.

## Symptom → Upstream Cues

If the boilerplate repeats across ≥ 5 handlers, fix upstream:

- Repeated `if err != nil { c.JSON(500, ...); return }` → centralize via error middleware.
- Each handler re-parsing `Authorization` header → one auth middleware attaching identity via `c.Set(...)`.
- Manual CORS headers per handler → `cors.New()` once on the router.

## Version Notes

- Go 1.22+: `http.ServeMux` supports method-qualified patterns — third-party routers optional for simple cases.
- `validator/v10`: tag syntax and error rendering differ from v9 — check against the installed version.
- Gin 1.10+: `Context.ClientIP()` honors trusted proxies; older `RemoteAddr` differs behind load balancers.

## Toolchain Compatibility

- `gin.SetMode(gin.ReleaseMode)` must run before `gin.New()` or debug middleware stays attached.
- `go test -race` surfaces context-aliasing bugs silent runs miss.
- `go mod tidy` on a fresh clone can upgrade transitive deps; pin `go.mod` `go` to match CI.
