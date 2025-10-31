import * as fs from 'fs';
import * as path from 'path';

/**
 * Logger that writes to both console and file
 */
export class TaskLogger {
  private logFile: string;
  private stream: fs.WriteStream;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;
  private originalStdoutWrite: typeof process.stdout.write;
  private isInConsoleLog: boolean = false;  // Flag to prevent double-logging
  
  constructor(outputDir: string, taskName: string) {
    // Create timestamp for log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `${taskName}-${timestamp}.log`;
    this.logFile = path.join(outputDir, logFileName);
    
    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Create write stream
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    
    // Store original functions
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    
    console.log(`📝 Logging to: ${this.logFile}\n`);
  }
  
  /**
   * Start intercepting console output
   */
  start() {
    const self = this;
    
    // Override console.log
    console.log = function(...args: any[]) {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      self.isInConsoleLog = true;
      self.originalConsoleLog.apply(console, args);
      self.isInConsoleLog = false;
      
      self.stream.write(message + '\n');
    };
    
    // Override console.error
    console.error = function(...args: any[]) {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      self.isInConsoleLog = true;
      self.originalConsoleError.apply(console, args);
      self.isInConsoleLog = false;
      
      self.stream.write('[ERROR] ' + message + '\n');
    };
    
    // Override console.warn
    console.warn = function(...args: any[]) {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      self.isInConsoleLog = true;
      self.originalConsoleWarn.apply(console, args);
      self.isInConsoleLog = false;
      
      self.stream.write('[WARN] ' + message + '\n');
    };
    
    // Override process.stdout.write for streaming output (e.g., LLM responses)
    // Only intercept if it's not from console.log (to avoid duplication)
    process.stdout.write = function(chunk: any, ...args: any[]): boolean {
      const str = chunk.toString();
      
      // Only write to file if NOT called from console.log
      if (!self.isInConsoleLog) {
        self.stream.write(str);
      }
      
      return self.originalStdoutWrite(chunk, ...args);
    };
  }
  
  /**
   * Stop intercepting and restore original functions
   */
  stop() {
    // First restore original functions
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
    process.stdout.write = this.originalStdoutWrite;
    
    // Force flush before ending
    // @ts-ignore - _handle is internal Node.js API
    if (typeof process.stdout._handle?.flush === 'function') {
      // @ts-ignore
      process.stdout._handle.flush();
    }
    
    // End stream synchronously
    this.stream.end();
    
    this.originalConsoleLog(`\n📝 Log saved to: ${this.logFile}`);
  }
  
  /**
   * Stop intercepting and wait for stream to finish (async version)
   */
  async stopAsync(): Promise<void> {
    return new Promise((resolve) => {
      // First restore original functions
      console.log = this.originalConsoleLog;
      console.error = this.originalConsoleError;
      console.warn = this.originalConsoleWarn;
      process.stdout.write = this.originalStdoutWrite;
      
      // End stream and wait for finish
      this.stream.end(() => {
        this.originalConsoleLog(`\n📝 Log saved to: ${this.logFile}`);
        resolve();
      });
    });
  }
  
  /**
   * Get log file path
   */
  getLogFile(): string {
    return this.logFile;
  }
}

