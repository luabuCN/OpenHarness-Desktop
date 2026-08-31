import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { MAX_DIFF_OUTPUT_LINES } from "./file-changes.js";

/** Normalized git status shared by the agent tools and the git panel API. */
export interface GitStatusSummary {
  isRepo: true;
  root: string;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: string[];
  changed: string[];
  untracked: string[];
  conflicted: string[];
}

export type GitStatusResult =
  | ({ available: true } & GitStatusSummary)
  | { available: false; isRepo: boolean; reason: string };

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  message: string;
}

let gitAvailable: boolean | null = null;

/** Probes the system git binary once per process; missing git degrades every
 * git tool and panel endpoint instead of crashing the run. */
export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  try {
    const version = await simpleGit().version();
    gitAvailable = Boolean(version);
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

/** All git operations run from the workspace/project root so credentials and
 * hooks resolve exactly as they would in a terminal. */
export function createGitClient(root: string): SimpleGit {
  return simpleGit({
    baseDir: root,
    maxConcurrentProcesses: 5,
    config: ["core.quotepath=false"],
  });
}

/** Confine a repo-relative path to root; returns the workspace-relative form
 * git commands expect, or throws when the path escapes the root. */
export function confineGitPath(root: string, target: string): string {
  const absolute = path.resolve(root, target);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Access denied outside project root: ${target}`);
  }
  return relative.replaceAll("\\", "/");
}

export async function summarizeStatus(git: SimpleGit, root: string): Promise<GitStatusResult> {
  if (!(await isGitAvailable())) {
    return { available: false, isRepo: false, reason: "系统未安装 git 或 git 不在 PATH 中。" };
  }
  try {
    if (!(await git.checkIsRepo())) {
      return { available: false, isRepo: false, reason: "当前目录不是 git 仓库。" };
    }
    const status = await git.status();
    return {
      available: true,
      isRepo: true,
      root,
      branch: status.current || null,
      ahead: status.ahead,
      behind: status.behind,
      staged: [...status.staged, ...status.renamed.map((entry) => `${entry.from} -> ${entry.to}`)],
      changed: [...status.modified, ...status.deleted],
      untracked: [...status.not_added],
      conflicted: [...status.conflicted],
    };
  } catch (error) {
    return {
      available: false,
      isRepo: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Cap raw diff output by lines so tool results and API payloads stay small. */
export function clampDiff(diff: string): { diff: string; truncated: boolean } {
  const lines = diff.split("\n");
  if (lines.length <= MAX_DIFF_OUTPUT_LINES) return { diff, truncated: false };
  return {
    diff:
      lines.slice(0, MAX_DIFF_OUTPUT_LINES).join("\n") +
      `\n\\ diff truncated after ${MAX_DIFF_OUTPUT_LINES} lines (${lines.length} total)`,
    truncated: true,
  };
}

export async function readLog(git: SimpleGit, limit: number): Promise<GitLogEntry[]> {
  const log = await git.log({ maxCount: limit });
  return log.all.map((entry) => ({
    hash: entry.hash,
    shortHash: entry.hash.slice(0, 7),
    date: entry.date,
    author: entry.author_name,
    message: entry.message,
  }));
}

/** Stage the requested paths then commit them; committing with a pathspec
 * limits the commit to exactly the selected files. */
export async function commitPaths(
  git: SimpleGit,
  root: string,
  files: string[],
  message: string,
): Promise<{ commit: string; summary: Record<string, unknown> }> {
  const relativeFiles = files.map((file) => confineGitPath(root, file));
  await git.add(relativeFiles);
  const result = await git.commit(message, relativeFiles);
  return { commit: result.commit, summary: { ...result.summary } };
}
