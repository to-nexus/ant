## 🖥️ Node.js API Server Environment Rules

**You are working on BACKEND API SERVER code (Express, NestJS, Fastify)**

This code will be **executed in Node.js runtime** on the server, NOT in browsers.

---

### ✅ Environment Detection Confirmed

**Detected indicators:**
- Project type: Node.js API Server
- Backend framework: Express/Fastify/NestJS/Koa
- Structure: Routes, controllers, services, models
- Database: Prisma/TypeORM/Mongoose/Sequelize
- Target locations: `src/routes/`, `src/controllers/`, `src/services/`, `src/models/`

---

### ✅ ALLOWED: Full Node.js API Access

**All Node.js built-in modules are available:**

```typescript
// ✅ Filesystem operations
import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';

// ✅ HTTP server
import http from 'http';
import https from 'https';

// ✅ Crypto operations
import crypto from 'crypto';

// ✅ System operations
import os from 'os';
import process from 'process';

// ✅ Streams and buffers
import stream from 'stream';
import { Buffer } from 'buffer';

// ✅ Child processes
import { spawn, exec } from 'child_process';

// ✅ Other utilities
import util from 'util';
import querystring from 'querystring';
import url from 'url';
```

---

### 🎯 Best Practices for Node.js API Servers

#### 1. **Async/Await for File Operations**

```typescript
// ✅ Prefer async/await with fs/promises
import fs from 'fs/promises';

async function readConfig() {
  const data = await fs.readFile('./config.json', 'utf-8');
  return JSON.parse(data);
}

async function writeLog(message: string) {
  await fs.appendFile('./logs/app.log', `${new Date().toISOString()} - ${message}\n`);
}

// ⚠️ Avoid sync methods in request handlers (blocks event loop)
// ❌ BAD in request handler:
app.get('/data', (req, res) => {
  const data = fs.readFileSync('./data.json', 'utf-8'); // ❌ Blocks server!
  res.json(JSON.parse(data));
});

// ✅ GOOD in request handler:
app.get('/data', async (req, res) => {
  const data = await fs.readFile('./data.json', 'utf-8'); // ✅ Non-blocking
  res.json(JSON.parse(data));
});

// ✅ OK to use sync methods in:
// - Startup configuration (before server starts)
// - CLI scripts
// - One-time initialization
```

#### 2. **ES Modules Configuration (CRITICAL)**

**When you see errors like:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...' imported from ...
```

**DO NOT add `.js` extensions to TypeScript source imports!**

**Instead, check and fix `tsconfig.json`:**

```json
{
  "compilerOptions": {
    "module": "NodeNext",           // ✅ NOT "ESNext"
    "moduleResolution": "NodeNext", // ✅ NOT "node"
    "target": "ES2020"
  }
}
```

**Common misconfigurations:**
```json
// ❌ BAD - causes ES Module resolution issues
{
  "module": "ESNext",
  "moduleResolution": "node"  // ← This is the problem!
}

// ✅ GOOD - proper ES Module support
{
  "module": "NodeNext",
  "moduleResolution": "NodeNext"
}
```

**Why this matters:**
- `package.json` has `"type": "module"` → Node.js uses ES Modules
- `moduleResolution: "node"` → Uses CommonJS-style resolution (no extensions)
- `moduleResolution: "NodeNext"` → Uses ES Module resolution (handles extensions correctly)

**If `tsconfig.json` is correct but error persists:**
1. Delete `dist/` folder: `rm -rf dist`
2. Rebuild: `npm run build`
3. Check if all `.js` files are generated in `dist/`

#### 3. **Path Resolution**

```typescript
// ✅ Use path module for cross-platform compatibility
import path from 'path';
import { fileURLToPath } from 'url';

// ✅ ES modules (__dirname equivalent)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Join paths safely
const configPath = path.join(__dirname, '..', 'config', 'database.json');
const uploadDir = path.resolve(process.cwd(), 'uploads');

// ✅ Normalize paths (handle .. and .)
const normalized = path.normalize(userInput); // Security: prevent path traversal

// ✅ Get file extension
const ext = path.extname(filename); // '.ts'
```

#### 3. **Environment Variables**

```typescript
// ✅ Access environment variables
const port = process.env.PORT || 3000;
const dbUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

// ✅ Use dotenv for development
import dotenv from 'dotenv';
dotenv.config();

// ✅ Validate required env vars at startup
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// ✅ Type-safe environment config
interface EnvironmentConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  nodeEnv: 'development' | 'production' | 'test';
}

export const config: EnvironmentConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  nodeEnv: (process.env.NODE_ENV as any) || 'development'
};
```

#### 4. **Error Handling**

```typescript
// ✅ Global error handler middleware (Express)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  
  // Don't leak internal errors to client
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

// ✅ Async error wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await getUserById(req.params.id); // Errors caught by asyncHandler
  res.json(user);
}));

// ✅ Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
```

#### 5. **Security Best Practices**

```typescript
// ✅ Sanitize file paths (prevent path traversal)
import path from 'path';

function getUploadPath(filename: string): string {
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const requestedPath = path.join(uploadsDir, filename);
  const normalizedPath = path.resolve(requestedPath);
  
  // Ensure path is within uploads directory
  if (!normalizedPath.startsWith(uploadsDir)) {
    throw new Error('Invalid file path');
  }
  
  return normalizedPath;
}

// ✅ Hash passwords
import crypto from 'crypto';
import bcrypt from 'bcrypt';

// Option 1: bcrypt (recommended for passwords)
const hashedPassword = await bcrypt.hash(password, 10);
const isValid = await bcrypt.compare(password, hashedPassword);

// Option 2: crypto (for other data)
const hash = crypto.createHash('sha256').update(data).digest('hex');

// ✅ Generate secure tokens
const token = crypto.randomBytes(32).toString('hex');

// ✅ Use helmet for HTTP security headers
import helmet from 'helmet';
app.use(helmet());

// ✅ Rate limiting
import rateLimit from 'express-rate-limit';
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);
```

#### 6. **Database Layer Patterns**

```typescript
// ✅ Use ORM/Query builders
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ✅ Repository pattern
export class UserRepository {
  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }
  
  async create(data: CreateUserDto) {
    return prisma.user.create({ data });
  }
  
  async update(id: string, data: UpdateUserDto) {
    return prisma.user.update({ where: { id }, data });
  }
}

// ✅ Service layer (business logic)
export class UserService {
  constructor(private userRepo: UserRepository) {}
  
  async registerUser(email: string, password: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return this.userRepo.create({ email, password: hashedPassword });
  }
}

// ✅ Controller layer (HTTP handling)
export class UserController {
  constructor(private userService: UserService) {}
  
  register = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const user = await this.userService.registerUser(email, password);
    res.status(201).json(user);
  };
}
```

#### 7. **Logging**

```typescript
// ✅ Structured logging
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// ✅ Request logging middleware
import morgan from 'morgan';
app.use(morgan('combined', {
  stream: { write: message => logger.info(message.trim()) }
}));
```

---

### ❌ Things to Avoid in Node.js API Servers

```typescript
// ❌ BAD: Blocking operations in request handlers
app.get('/data', (req, res) => {
  const data = fs.readFileSync('./large-file.json'); // ❌ Blocks event loop!
  res.send(data);
});

// ✅ GOOD: Use async operations
app.get('/data', async (req, res) => {
  const data = await fs.readFile('./large-file.json');
  res.send(data);
});

// ❌ BAD: Hardcoded secrets
const API_KEY = 'sk-1234567890abcdef';  // ❌ NEVER!

// ✅ GOOD: Environment variables
const API_KEY = process.env.API_KEY;

// ❌ BAD: No error handling
app.get('/users/:id', async (req, res) => {
  const user = await db.findUser(req.params.id); // ❌ What if it throws?
  res.json(user);
});

// ✅ GOOD: Proper error handling
app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.findUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});
```

---

### 🔍 Self-Check Before Output

**For EVERY API server file you generate:**

1. **Architecture check:**
   - [ ] Using layered architecture (controllers → services → repositories)
   - [ ] Separation of concerns (HTTP ↔ business logic ↔ data access)

2. **Async/Await:**
   - [ ] Using `async/await` for all I/O operations
   - [ ] No blocking sync operations in request handlers

3. **Security:**
   - [ ] Path traversal prevention (sanitize user file paths)
   - [ ] Password hashing (bcrypt)
   - [ ] Environment variables for secrets
   - [ ] Input validation and sanitization

4. **Error Handling:**
   - [ ] Try-catch blocks for async operations
   - [ ] Global error handler middleware
   - [ ] Proper HTTP status codes (200, 201, 400, 404, 500)

5. **Performance:**
   - [ ] Database query optimization (indexes, N+1 prevention)
   - [ ] Caching where appropriate (Redis, in-memory)
   - [ ] Rate limiting for public endpoints

---

### 📋 Final Checklist

- [ ] Used `fs/promises` for async file operations
- [ ] Used `path` module for cross-platform path handling
- [ ] Environment variables for configuration
- [ ] Proper error handling (try-catch, error middleware)
- [ ] Security best practices (helmet, rate limiting, input validation)
- [ ] Layered architecture (controller → service → repository)
- [ ] Structured logging
- [ ] Database connection pooling and error handling

**Node.js API servers have full access to system resources—use them wisely and securely!**

