import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";
import os from "os";

const GIT_TOKEN = process.env.GIT_TOKEN;
const GIT_DEFAULT_OWNER = process.env.GIT_DEFAULT_OWNER;
const GIT_DEFAULT_BASE = process.env.GIT_DEFAULT_BASE || "main";

export async function loadProjectGitConfig(project: string) {
  const configPath = path.join(process.cwd(), "workspace", project, "config.json");
  if (!fs.existsSync(configPath)) throw new Error(`No config.json for project: ${project}`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/**
 * Resolve localPath to absolute path
 * - If absolute path: use as-is
 * - If relative path: resolve from ant project root (process.cwd())
 */
export function resolveLocalPath(localPath: string, project: string): string {
  if (path.isAbsolute(localPath)) {
    return localPath;
  }
  
  // Relative path: resolve from ant project root
  // Example: "../test-app" → /Users/probe/dev/ant/../test-app → /Users/probe/dev/test-app
  return path.resolve(process.cwd(), localPath);
}

export async function getGitInstance(project: string, config: any) {
  if (config.repoType === "local") {
    // Resolve localPath to absolute path
    const localPath = resolveLocalPath(config.localPath, project);
    
    console.log(`📂 Working directory: ${localPath}`);
    
    // Ensure localPath directory exists
    if (!fs.existsSync(localPath)) {
      console.log(`📁 Creating local repository directory: ${localPath}`);
      fs.mkdirSync(localPath, { recursive: true });
    }
    
    // Check if git repository is initialized
    const gitDir = path.join(localPath, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(`🔧 Initializing git repository: ${localPath}`);
      const git = simpleGit(localPath);
      await git.init();
      console.log(`✅ Git repository initialized`);
    }
    
    return simpleGit(localPath);
  } else {
    const tmpDir = path.join(os.tmpdir(), `${project}-${Date.now()}`);
    const git = simpleGit();
    await git.clone(config.repoUrl, tmpDir, ["--depth", "1"]);
    return simpleGit(tmpDir);
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
  await git.fetch();
  
  const branches = await git.branch();
  const localExists = branches.all.includes(branch);
  const remoteExists = branches.all.includes(`remotes/origin/${branch}`);
  
  if (localExists || remoteExists) {
    console.log(`📌 Branch '${branch}' already exists, checking out...`);
    await git.checkout(branch);
  } else {
    console.log(`🌿 Creating new branch '${branch}' from origin/${base}...`);
    await git.checkoutBranch(branch, `origin/${base}`);
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

export async function openPullRequest(config: any, branch: string, title: string, body: string) {
  if (config.repoType !== "remote") return;
  const octokit = new Octokit({ auth: GIT_TOKEN });
  await octokit.pulls.create({
    owner: config.owner || GIT_DEFAULT_OWNER,
    repo: config.repo,
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
