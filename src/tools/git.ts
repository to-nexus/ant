import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";
import os from "os";

const GIT_TOKEN = process.env.GIT_TOKEN;
const GIT_DEFAULT_OWNER = process.env.GIT_DEFAULT_OWNER;
const GIT_DEFAULT_BASE = process.env.GIT_DEFAULT_BASE || "main";

export async function loadProjectGitConfig(project: string) {
  const configPath = path.join(process.cwd(), "projects", project, "config.json");
  if (!fs.existsSync(configPath)) throw new Error(`No config.json for project: ${project}`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export async function getGitInstance(project: string, config: any) {
  if (config.repoType === "local") {
    return simpleGit(config.localPath);
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
  
  // Check if branch already exists locally or remotely
  const branches = await git.branch();
  const localExists = branches.all.includes(branch);
  const remoteExists = branches.all.includes(`remotes/origin/${branch}`);
  
  if (localExists || remoteExists) {
    // Branch exists, just checkout
    console.log(`📌 Branch '${branch}' already exists, checking out...`);
    await git.checkout(branch);
  } else {
    // Create new branch
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
