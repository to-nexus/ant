import data from './github-stats.json';

export interface Contributor {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
}

export interface ActivityItem {
  number: number;
  title: string;
  htmlUrl: string;
  author: string;
  mergedAt?: string;
  createdAt?: string;
}

export interface GitHubStats {
  stars: number;
  forks: number;
  contributorsCount: number;
  openIssues: number;
  contributors: Contributor[];
  recentPRs: ActivityItem[];
  recentIssues: ActivityItem[];
  goodFirstIssues: ActivityItem[];
  lastUpdated: string;
}

export const githubStats: GitHubStats = data as GitHubStats;
