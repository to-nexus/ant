/**
 * Command Tools
 * 
 * Tools for executing shell commands (npm install, build, test, etc.)
 */

import { Tool } from './registry';
import { CommandPort } from '../../../core/ports';

/**
 * run_command tool
 * Executes a shell command in the project directory
 * 
 * CRITICAL: This allows LLM to:
 * - Install dependencies: npm install, npm install axios
 * - Run builds: npm run build, npm run dev
 * - Run tests: npm test, npm run lint
 * - Execute任意 commands: npx prisma generate, etc.
 */
export function createRunCommandTool(commandPort: CommandPort, projectPath: string): Tool {
  return {
    definition: {
      name: 'run_command',
      description: `Execute a shell command in the project directory. Use this to:
- Install dependencies (e.g., "npm install", "npm install axios")
- Run builds (e.g., "npm run build", "npm run dev")
- Run tests (e.g., "npm test", "npm run lint")
- List files (e.g., "ls -la", "find . -name '*.ts'")
- Check file contents (e.g., "cat package.json", "grep -r 'pattern' src/")
- Execute任意 commands (e.g., "npx prisma generate")

CRITICAL: Use 'working_directory' parameter instead of 'cd':
❌ WRONG: "cd src/domain && ls -la" (cd doesn't work in subshells)
✅ CORRECT: command="ls -la", working_directory="src/domain"

IMPORTANT: Command output is streamed in real-time. If a command fails, you can see the error and retry with fixes.`,
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute (e.g., "npm install axios", "npm run build")',
          },
          working_directory: {
            type: 'string',
            description: 'Optional working directory (relative to project root). Use this instead of "cd" in command. Example: "src/domain/validators". Defaults to project root.',
          },
        },
        required: ['command'],
      },
    },
    executor: async (input: Record<string, any>) => {
      const { command, working_directory } = input;
      
      if (!command || typeof command !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "command" parameter',
        };
      }

      // Security: Block dangerous commands
      const dangerousPatterns = [
        /rm\s+-rf\s+\//,  // rm -rf /
        /:\(\)\{.*;\}/,   // Fork bomb
        /shutdown/,
        /reboot/,
        /format/,
      ];
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
          return {
            error: true,
            message: `Dangerous command blocked: ${command}`,
            command,
          };
        }
      }

      try {
        const workingDir = working_directory 
          ? `${projectPath}/${working_directory}`
          : projectPath;

        console.log(`\n🔧 [run_command] Executing: ${command}`);
        console.log(`   Working directory: ${workingDir}\n`);

        let stdout = '';
        let stderr = '';
        let exitCode: number | undefined;

        // Execute command with streaming output
        await commandPort.execute(command, {
          cwd: workingDir,
          onStdout: (chunk: string) => {
            stdout += chunk;
            console.log(chunk);  // Real-time output
          },
          onStderr: (chunk: string) => {
            stderr += chunk;
            console.error(chunk);  // Real-time errors
          },
          onExit: (code: number) => {
            exitCode = code;
          },
        });

        const success = exitCode === 0;
        const output = stdout + stderr;

        if (success) {
          console.log(`\n✅ [run_command] Command succeeded (exit code: ${exitCode})\n`);
        } else {
          console.error(`\n❌ [run_command] Command failed (exit code: ${exitCode})\n`);
        }

        return {
          success,
          command,
          working_directory: workingDir,
          stdout,
          stderr,
          output,
          exitCode,
          message: success 
            ? `Command executed successfully: ${command}`
            : `Command failed with exit code ${exitCode}: ${command}`,
        };
      } catch (error: any) {
        console.error(`\n❌ [run_command] Execution error: ${error.message}\n`);
        
        return {
          error: true,
          success: false,
          message: `Failed to execute command: ${error.message}`,
          command,
          stderr: error.message,
        };
      }
    },
  };
}

