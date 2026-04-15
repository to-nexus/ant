# NestJS Framework Profile

## Module Architecture

**Principle**: NestJS enforces modular architecture. Each feature is encapsulated in a module with its own controllers, services, and providers.

**Observation target**: Does the feature being implemented belong to an existing module or require a new one?

| Checkpoint | What to observe |
|-----------|----------------|
| **Module boundary** | Does this feature fit into an existing module scope? |
| **Provider registration** | Are all injectable services registered in the module's `providers` array? |
| **Export visibility** | If a service is needed by other modules, is it in the `exports` array? |

---

## Dependency Injection

**Constraint**: Use constructor injection exclusively. Do NOT use `@Inject()` with string tokens unless interfacing with non-class providers.

**Constraint**: Services should depend on abstractions (interfaces) at module boundaries. Within a module, concrete class injection is acceptable.

---

## Decorator Patterns

**Constraint**: Use NestJS decorators for cross-cutting concerns (guards, interceptors, pipes) rather than middleware when possible. Decorators are type-safe and composable.

| Concern | Mechanism |
|---------|-----------|
| Authentication | Guards (`@UseGuards`) |
| Validation | Pipes (`@UsePipes`, `ValidationPipe`) |
| Transformation | Interceptors (`@UseInterceptors`) |
| Logging | Interceptors |

---

## Configuration

**Principle**: Use `@nestjs/config` with `.env` files and typed configuration. Do NOT access `process.env` directly in services.

⚠️ **Blind spot**: Forgetting to import `ConfigModule` in the consuming module causes `ConfigService` injection to fail silently at runtime, not at compile time.
