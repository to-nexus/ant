# NestJS Framework Hints

Blind-spot reminders. Pre-training gap only.

## Entry-Point Topology

Routing/wiring is a **central registry**: feature modules register into the root `AppModule` (`imports: [...]`), and the DI container resolves providers. The root module composition is an **`integration`-band-owned** file — many features register there. Controllers/services are authored in the **feature band** (so the module can import them); do not let feature tasks each edit the root module's `imports` in parallel — the integration band consolidates module registration.

## Forbidden Patterns

- `process.env.X` in services instead of `ConfigService.get('X')` → fails under `ConfigModule.forFeature` schema.
- `providers: [Svc]` consumed across modules without `exports: [Svc]` → "No provider for Svc" at startup.
- `@Inject()` string tokens mixed with class-based injection on one constructor → runtime DI error.
- Circular imports patched with `forwardRef()` everywhere → architectural problem; reshape the graph.

## Symptom → Upstream Cues

If the shim is added to every feature, fix upstream:

- `@UseGuards(AuthGuard)` on every controller → apply globally via `APP_GUARD`.
- `ValidationPipe` attached per handler → `app.useGlobalPipes(new ValidationPipe())`.
- Each service injecting `Logger` manually → global logger at bootstrap; receive via DI.

## Version Notes

- NestJS 10+: Fastify adapter changed request/response shapes — confirm adapter before Express-only middleware.
- `@nestjs/config` v3: schema validation supports Joi or `class-validator`; older Joi-only usage undocumented.
- TypeORM and Prisma modules ship different testing helpers — `getRepositoryToken` vs `PrismaService` differ.

## Toolchain Compatibility

- `platform-fastify` vs `platform-express` change `Request` / `Response` typing — do NOT import Express types under Fastify.
- `nest start --builder swc` skips decorator metadata by default — explicit SWC config needed.
- `ts-jest` vs SWC Jest diverge on decorator metadata; `@Injectable()`-only classes may fail under SWC Jest.
