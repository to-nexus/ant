# Go Language Hints

Blind-spot reminders. Pre-training gap only.

## Forbidden Patterns

- Loop variable captured by a goroutine on Go < 1.22 → all goroutines see the final `x`; Go 1.22+ flips this with per-iteration scoping.
- Returning a slice aliasing a large underlying array (`return big[lo:hi]`) → GC retains the whole array; use `slices.Clone` if the slice outlives the source.
- `defer` inside a long-running loop accumulating file handles → iterations exhaust FDs before any defer runs.
- `context.WithTimeout(...)` without `defer cancel()` → goroutine leak.

## Symptom → Upstream Cues

If the boilerplate repeats, fix upstream:

- Repeated `fmt.Errorf("...: %w", err)` with identical prefixes → a domain error type (sentinels / `errors.Join`) is missing.
- Every handler re-extracting the same `context.Context` fields → the extractor belongs in middleware.
- Each package re-initializing its own logger → inject a shared `*slog.Logger` via config.

## Version Notes

- Go 1.21+: `slices`, `maps`, `cmp` are stdlib — do NOT use `golang.org/x/exp/slices` in new code.
- Go 1.22: `http.ServeMux` supports method-qualified patterns (`"GET /users/{id}"`).
- `log/slog` is the default structured logger — integrates with tests via `slog.Default()`.

## Toolchain Compatibility

- `go test -race` reveals data races `go test` alone hides — CI must run race.
- `go generate` is NOT invoked by `go build` — commit generated files or run it in CI.
- `GOFLAGS` / `GOEXPERIMENT` silently change build behavior; confirm local and CI match.
