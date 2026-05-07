#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = process.env.ANT_SITE_REPO ?? 'to-nexus/ant';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'github-stats.json');

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function pickActivity(item) {
  return {
    number: item.number,
    title: item.title,
    htmlUrl: item.html_url,
    author: item.user?.login ?? 'unknown',
    mergedAt: item.merged_at ?? undefined,
    createdAt: item.created_at,
  };
}

async function main() {
  const repo = await gh(`/repos/${REPO}`);
  const contributors = await gh(`/repos/${REPO}/contributors?per_page=50`);
  const closedPRs = await gh(`/repos/${REPO}/pulls?state=closed&per_page=20&sort=updated&direction=desc`);
  const openIssues = await gh(`/repos/${REPO}/issues?state=open&per_page=20&sort=created&direction=desc`);
  const goodFirst = await gh(`/repos/${REPO}/issues?state=open&per_page=10&labels=good%20first%20issue`);

  const recentPRs = closedPRs
    .filter((pr) => pr.merged_at)
    .slice(0, 5)
    .map(pickActivity);

  const recentIssues = openIssues
    .filter((i) => !i.pull_request)
    .slice(0, 5)
    .map(pickActivity);

  const data = {
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    contributorsCount: contributors.length,
    openIssues: repo.open_issues_count ?? 0,
    contributors: contributors.map((c) => ({
      login: c.login,
      avatarUrl: c.avatar_url,
      htmlUrl: c.html_url,
      contributions: c.contributions,
    })),
    recentPRs,
    recentIssues,
    goodFirstIssues: goodFirst.filter((i) => !i.pull_request).map(pickActivity),
    lastUpdated: new Date().toISOString().slice(0, 10),
  };

  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✓ Wrote ${OUT}`);
  console.log(`  stars=${data.stars} forks=${data.forks} contributors=${data.contributorsCount} openIssues=${data.openIssues}`);
}

main().catch((err) => {
  console.error('✗ refresh-github-stats failed:', err.message);
  process.exitCode = 1;
});
