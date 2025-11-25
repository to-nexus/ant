import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";
import os from "os";
import { CredentialStore } from "../../../utils/credentialStore";
import { UserContext } from "../../../core/types/user";

const GIT_DEFAULT_BASE = process.env.GIT_DEFAULT_BASE || "main";

export async function loadProjectGitConfig(project: string) {
  // ✅ Require ANT_PROJECT_PATH - no fallback
  const projectPath = process.env.ANT_PROJECT_PATH;
  
  if (!projectPath) {
    throw new Error(
      'ANT_PROJECT_PATH environment variable is required.\n' +
      'This should be set by the HTTP server when spawning CLI processes.\n' +
      'Use WorkspaceResolver.getProjectPath() to generate the correct path.'
    );
  }
  
  const configPath = path.join(projectPath, "config.json");
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`No config.json for project: ${project}\nExpected at: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/**
 * Resolve localPath to absolute path
 * - If absolute path: use as-is
 * - If starts with ~: expand to home directory
 * - If relative path: resolve from ant project root (process.cwd())
 */
export function resolveLocalPath(localPath: string, project: string): string {
  if (path.isAbsolute(localPath)) {
    return localPath;
  }
  
  // Handle tilde (~) expansion
  if (localPath.startsWith('~/')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDir, localPath.slice(2));
  }
  
  // Relative path: resolve from ant project root
  // Example: "../test-app" → /Users/probe/dev/ant/../test-app → /Users/probe/dev/test-app
  return path.resolve(process.cwd(), localPath);
}

export async function getGitInstance(project: string, config: any) {
  if (config.repoType === "local") {
    // Local workspace: use localPath
    if (!config.localPath) {
      throw new Error(`localPath is required for repoType "local"`);
    }
    const localPath = resolveLocalPath(config.localPath, project);
    console.log(`📂 Working directory: ${localPath}`);
    if (!fs.existsSync(localPath)) {
      console.log(`📁 Creating repository directory: ${localPath}`);
      fs.mkdirSync(localPath, { recursive: true });
    }
    const gitDir = path.join(localPath, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(`🔧 Initializing git repository: ${localPath}`);
      const git = simpleGit(localPath);
      await git.init();
      console.log(`✅ Git repository initialized`);
    }
    return simpleGit(localPath);
  } else if (config.repoType === "cloud") {
    // Cloud workspace: use projectPath from SimpleGitAdapter
    // projectPath is passed as cwd to simpleGit by SimpleGitAdapter
    // No localPath required
    // Just return simpleGit with cwd set to projectPath
    if (!config.projectPath) {
      throw new Error(`projectPath is required for repoType "cloud"`);
    }
    const projectPath = config.projectPath;
    console.log(`📂 Working directory (cloud): ${projectPath}`);
    if (!fs.existsSync(projectPath)) {
      console.log(`📁 Creating repository directory: ${projectPath}`);
      fs.mkdirSync(projectPath, { recursive: true });
    }
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(`🔧 Initializing git repository: ${projectPath}`);
      const git = simpleGit(projectPath);
      await git.init();
      console.log(`✅ Git repository initialized`);
    }
    return simpleGit(projectPath);
  } else if (config.repoUrl) {
    // Remote repository (GitHub/GitLab): clone to temp directory
    const tmpDir = path.join(os.tmpdir(), `${project}-${Date.now()}`);
    const git = simpleGit();
    await git.clone(config.repoUrl, tmpDir, ["--depth", "1"]);
    return simpleGit(tmpDir);
  } else {
    throw new Error(`Unsupported config: repoType="${config.repoType}", repoUrl=${config.repoUrl}`);
  }
}

export async function getCurrentBranch(git: any): Promise<string> {
  const result = await git.branch();
  return result.current;
}

export async function getLatestCommit(git: any): Promise<{ hash: string; date: string }> {
  const log = await git.log({ maxCount: 1 });
  if (log.latest) {
    return {
      hash: log.latest.hash,
      date: log.latest.date
    };
  }
  throw new Error("No commits found");
}

export async function createBranch(git: any, branch: string, base: string) {
  // 1. Check if there are any commits
  const log = await git.log({ maxCount: 1 }).catch(() => null);
  
  if (!log || !log.latest) {
    // No commits yet - create initial commit
    console.log('📝 Creating initial commit...');
    await git.commit('Initial commit', {'--allow-empty': null});
  }
  
  // 2. Create or checkout branch (local only, no origin dependency)
  const branches = await git.branch();
  
  if (branches.all.includes(branch)) {
    console.log(`📌 Branch '${branch}' already exists, checking out...`);
    await git.checkout(branch);
  } else {
    console.log(`🌿 Creating local branch '${branch}'...`);
    await git.checkoutLocalBranch(branch);
  }
}

export async function stageOnly(git: any, filePath: string, content: string) {
  const baseDir = await git.revparse(['--show-toplevel']);
  const fullPath = path.join(baseDir.trim(), filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");

  await git.add(filePath);
}

export async function commitAndPush(git: any, filePath: string, content: string, message: string, branch: string) {
  const baseDir = await git.revparse(['--show-toplevel']);
  const fullPath = path.join(baseDir.trim(), filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");

  await git.add(filePath);
  await git.commit(message);
  await git.push("origin", branch);
}

export async function openPullRequest(
  config: any, 
  branch: string, 
  title: string, 
  body: string,
  userContext: UserContext,
  workspaceRoot: string
) {
  if (config.repoType !== "remote") return;
  
  // Get PAT from credential store
  const credentialStore = new CredentialStore(workspaceRoot);
  const pat = await credentialStore.getPAT(userContext);
  
  if (!pat) {
    throw new Error('GitHub PAT not configured. Please configure it in project settings.');
  }
  
  // Parse owner and repo from githubRepo URL if available
  let owner = config.owner;
  let repo = config.repo;
  
  if (config.githubRepo && !owner && !repo) {
    const match = config.githubRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) {
      owner = match[1];
      repo = match[2];
    }
  }
  
  if (!owner || !repo) {
    throw new Error('GitHub owner and repo must be specified in config');
  }
  
  const octokit = new Octokit({ auth: pat });
  await octokit.pulls.create({
    owner,
    repo,
    title,
    head: branch,
    base: config.branchBase || GIT_DEFAULT_BASE,
    body
  });
}

/**
 * Get list of changed files (unstaged and staged)
 */
export async function getChangedFiles(git: any): Promise<string[]> {
  const status = await git.status();
  const files = new Set<string>();
  
  // Add modified files
  status.modified.forEach((f: string) => files.add(f));
  status.created.forEach((f: string) => files.add(f));
  status.deleted.forEach((f: string) => files.add(f));
  status.renamed.forEach((r: any) => files.add(r.to));
  
  return Array.from(files);
}

/**
 * Get file content from HEAD (last commit)
 * Returns null if file doesn't exist in HEAD (new file)
 */
export async function getFileFromHead(git: any, filePath: string): Promise<string | null> {
  try {
    const content = await git.show([`HEAD:${filePath}`]);
    return content;
  } catch (error) {
    // File doesn't exist in HEAD (newly created file)
    return null;
  }
}

/**
 * Get file content from working directory
 */
export async function getFileFromWorkingDir(git: any, filePath: string): Promise<string | null> {
  try {
    const baseDir = await git.revparse(['--show-toplevel']);
    const fullPath = path.join(baseDir.trim(), filePath);
    
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    return null;
  }
}
