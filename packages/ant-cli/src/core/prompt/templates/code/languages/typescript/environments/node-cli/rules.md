## 🛠️ Node.js CLI Tools Environment Rules

**You are working on NODE.JS CLI TOOLS AND SCRIPTS**

This code will be **executed directly in Node.js runtime** as command-line tools, build scripts, or automation tasks.

---

### ✅ Environment Detection Confirmed

**Detected indicators:**
- Project type: Node.js CLI/Scripts
- Execution: Command-line, npm scripts, build tools
- No web server or frontend framework
- Target locations: `scripts/`, `bin/`, `cli/`, root-level `.ts`/`.js` files

---

### ✅ ALLOWED: Full Node.js API Access

**All Node.js built-in modules are available:**

```typescript
// ✅ Full access to Node.js APIs
import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import process from 'process';
import child_process from 'child_process';
import readline from 'readline';
import util from 'util';
```

**Unlike API servers, CLI tools can freely use SYNC operations as they don't block other requests.**

---

### 🎯 CLI-Specific Best Practices

#### 1. **Command-Line Arguments**

```typescript
// ✅ Using process.argv
const args = process.argv.slice(2); // Remove 'node' and script path
const [command, ...options] = args;

console.log('Command:', command);
console.log('Options:', options);

// ✅ Using commander.js (recommended)
import { program } from 'commander';

program
  .name('my-cli')
  .description('My awesome CLI tool')
  .version('1.0.0');

program
  .command('build')
  .description('Build the project')
  .option('-w, --watch', 'Watch for changes')
  .option('-p, --production', 'Production build')
  .action((options) => {
    console.log('Building with options:', options);
    // Build logic here
  });

program.parse();

// ✅ Using yargs
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .command('build', 'Build the project', (yargs) => {
    return yargs
      .option('watch', {
        alias: 'w',
        type: 'boolean',
        description: 'Watch for changes'
      });
  })
  .help()
  .argv;
```

#### 2. **File System Operations (Sync is OK)**

```typescript
// ✅ Sync operations are OK in CLI tools (no concurrency concerns)
import fs from 'fs';
import path from 'path';

// Read file synchronously
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Write file synchronously
fs.writeFileSync('./output.json', JSON.stringify(data, null, 2));

// ✅ Async operations for better UX (show progress)
import fs from 'fs/promises';
import ora from 'ora';

const spinner = ora('Processing files...').start();

try {
  const files = await fs.readdir('./src');
  for (const file of files) {
    spinner.text = `Processing ${file}...`;
    await processFile(file);
  }
  spinner.succeed('All files processed!');
} catch (error) {
  spinner.fail('Processing failed');
  throw error;
}

// ✅ Recursive directory operations
import fs from 'fs/promises';

async function walkDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkDir(fullPath);
      } else {
        return fullPath;
      }
    })
  );
  return files.flat();
}
```

#### 3. **User Input and Prompts**

```typescript
// ✅ Simple readline
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('What is your name? ', (answer) => {
  console.log(`Hello, ${answer}!`);
  rl.close();
});

// ✅ Using inquirer (recommended)
import inquirer from 'inquirer';

const answers = await inquirer.prompt([
  {
    type: 'input',
    name: 'projectName',
    message: 'What is your project name?',
    default: 'my-project'
  },
  {
    type: 'list',
    name: 'framework',
    message: 'Choose a framework:',
    choices: ['React', 'Vue', 'Angular', 'Svelte']
  },
  {
    type: 'confirm',
    name: 'typescript',
    message: 'Use TypeScript?',
    default: true
  }
]);

console.log('Answers:', answers);

// ✅ Password input (hidden)
const { password } = await inquirer.prompt([
  {
    type: 'password',
    name: 'password',
    message: 'Enter password:',
    mask: '*'
  }
]);
```

#### 4. **Console Output and Formatting**

```typescript
// ✅ Colored output using chalk
import chalk from 'chalk';

console.log(chalk.green('✓ Success!'));
console.log(chalk.red('✗ Error occurred'));
console.log(chalk.yellow('⚠ Warning'));
console.log(chalk.blue('ℹ Info'));

console.log(chalk.bold.bgBlue(' BUILD '), 'Building project...');

// ✅ Progress bars
import cliProgress from 'cli-progress';

const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
bar.start(100, 0);

for (let i = 0; i <= 100; i++) {
  bar.update(i);
  await sleep(50);
}

bar.stop();

// ✅ Spinners
import ora from 'ora';

const spinner = ora('Loading...').start();
await someAsyncOperation();
spinner.succeed('Loaded!');

// ✅ Tables
import Table from 'cli-table3';

const table = new Table({
  head: ['Name', 'Size', 'Modified'],
  colWidths: [30, 15, 25]
});

table.push(
  ['index.ts', '1.2 KB', '2024-01-15'],
  ['config.json', '0.5 KB', '2024-01-14']
);

console.log(table.toString());

// ✅ Box messages
import boxen from 'boxen';

console.log(boxen('Build completed successfully!', {
  padding: 1,
  margin: 1,
  borderStyle: 'round',
  borderColor: 'green'
}));
```

#### 5. **Running External Commands**

```typescript
// ✅ Using child_process
import { exec, spawn, execSync } from 'child_process';
import util from 'util';

// Async exec
const execAsync = util.promisify(exec);

try {
  const { stdout, stderr } = await execAsync('npm install');
  console.log(stdout);
} catch (error) {
  console.error('Command failed:', error);
}

// Sync exec (OK in CLI tools)
const output = execSync('git status', { encoding: 'utf-8' });
console.log(output);

// Spawn for streaming output
const proc = spawn('npm', ['run', 'build'], {
  stdio: 'inherit' // Stream output to console
});

proc.on('close', (code) => {
  if (code === 0) {
    console.log('Build succeeded');
  } else {
    console.error(`Build failed with code ${code}`);
    process.exit(code);
  }
});

// ✅ Using execa (recommended)
import { execa } from 'execa';

try {
  await execa('npm', ['install'], {
    stdout: 'inherit',
    stderr: 'inherit'
  });
  console.log('Dependencies installed!');
} catch (error) {
  console.error('Installation failed');
  process.exit(1);
}
```

#### 6. **Error Handling and Exit Codes**

```typescript
// ✅ Proper error handling
async function main() {
  try {
    // CLI logic here
    console.log(chalk.green('✓ Success!'));
    process.exit(0); // Success
  } catch (error) {
    console.error(chalk.red('✗ Error:'), error.message);
    
    // Show stack trace in verbose mode
    if (process.env.VERBOSE) {
      console.error(error.stack);
    }
    
    process.exit(1); // Failure
  }
}

main();

// ✅ Signal handling
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...');
  // Cleanup logic here
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, exiting...');
  process.exit(0);
});

// ✅ Uncaught exception handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, 'reason:', reason);
  process.exit(1);
});
```

#### 7. **Configuration and Environment**

```typescript
// ✅ Load configuration files
import fs from 'fs';
import path from 'path';

function loadConfig(configPath?: string): Config {
  const defaultPath = path.join(process.cwd(), 'config.json');
  const finalPath = configPath || defaultPath;
  
  if (!fs.existsSync(finalPath)) {
    throw new Error(`Config file not found: ${finalPath}`);
  }
  
  const content = fs.readFileSync(finalPath, 'utf-8');
  return JSON.parse(content);
}

// ✅ Environment variables with dotenv
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.API_KEY;
const environment = process.env.NODE_ENV || 'development';

// ✅ Cosmiconfig (automatic config discovery)
import { cosmiconfig } from 'cosmiconfig';

const explorer = cosmiconfig('myapp');
const result = await explorer.search();

if (result) {
  console.log('Config found:', result.filepath);
  console.log('Config:', result.config);
}
```

#### 8. **Package.json Integration**

```json
{
  "name": "my-cli",
  "version": "1.0.0",
  "bin": {
    "mycli": "./bin/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  }
}
```

```typescript
// ✅ Make file executable
#!/usr/bin/env node

// CLI entry point
import { program } from 'commander';
// ... CLI logic
```

---

### ⚡ Common Patterns

```typescript
// ✅ Template copying (scaffolding)
import fs from 'fs-extra'; // Enhanced fs with more utilities

async function scaffold(projectName: string) {
  const templateDir = path.join(__dirname, '../templates/react');
  const targetDir = path.join(process.cwd(), projectName);
  
  // Copy template
  await fs.copy(templateDir, targetDir);
  
  // Update package.json
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = await fs.readJSON(pkgPath);
  pkg.name = projectName;
  await fs.writeJSON(pkgPath, pkg, { spaces: 2 });
  
  console.log(chalk.green(`✓ Created project: ${projectName}`));
}

// ✅ File watching
import chokidar from 'chokidar';

const watcher = chokidar.watch('src/**/*.ts', {
  ignored: /node_modules/,
  persistent: true
});

watcher.on('change', (path) => {
  console.log(`File ${path} changed, rebuilding...`);
  // Rebuild logic
});

// ✅ Git operations
import simpleGit from 'simple-git';

const git = simpleGit();

// Check if directory is a git repo
const isRepo = await git.checkIsRepo();

// Get current branch
const branch = await git.branchLocal();

// Stage and commit
await git.add('.');
await git.commit('Initial commit');
```

---

### 📋 Final Checklist

- [ ] Used command-line argument parser (commander, yargs)
- [ ] Proper error handling with exit codes (0 = success, 1+ = failure)
- [ ] User-friendly output (chalk, ora, cli-progress)
- [ ] Interactive prompts when needed (inquirer)
- [ ] Configuration file loading (cosmiconfig, dotenv)
- [ ] Executable shebang (`#!/usr/bin/env node`) for bin files
- [ ] Signal handling (SIGINT, SIGTERM)
- [ ] Help text and version flag

**CLI tools are synchronous by nature—use sync operations freely, but async for better UX!**

