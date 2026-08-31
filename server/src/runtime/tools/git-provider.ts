import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolDescriptor, ToolProvider } from "./registry.js";
import type { RunContext } from "./run-context.js";
import type { RuntimeTool } from "./types.js";
import {
  clampDiff,
  commitPaths,
  confineGitPath,
  createGitClient,
  isGitAvailable,
  readLog,
  summarizeStatus,
} from "../git-utils.js";

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createGitTools(run: RunContext): Record<string, RuntimeTool> {
  const git = createGitClient(run.workspacePath);

  const requireRepo = async () => {
    if (!(await isGitAvailable())) {
      throw new Error("git is not available on this system.");
    }
    if (!(await git.checkIsRepo())) {
      throw new Error(`Not a git repository: ${run.workspacePath}`);
    }
  };

  return {
    gitStatus: createTool({
      id: "gitStatus",
      description:
        "Show the git status of the workspace: current branch, ahead/behind counts, staged/changed/untracked files.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const status = await summarizeStatus(git, run.workspacePath);
          if (!status.available) return { error: status.reason };
          return {
            branch: status.branch,
            ahead: status.ahead,
            behind: status.behind,
            staged: status.staged,
            changed: status.changed,
            untracked: status.untracked,
            conflicted: status.conflicted,
          };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),

    gitDiff: createTool({
      id: "gitDiff",
      description:
        "Show a unified diff of git changes. Defaults to the working tree; pass staged=true for staged changes, or a path to limit to one file. Untracked files are not included.",
      inputSchema: z.object({
        path: z.string().min(1).optional().describe("Optional file path to limit the diff"),
        staged: z.boolean().optional().describe("Diff the index (staged changes) instead of the working tree"),
      }),
      execute: async ({ path: target, staged }) => {
        try {
          await requireRepo();
          const args: string[] = [];
          if (staged) args.push("--cached");
          if (target) args.push(confineGitPath(run.workspacePath, target));
          const raw = await git.diff(args);
          const { diff, truncated } = clampDiff(raw);
          return { diff: diff || "(no changes)", truncated };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),

    gitLog: createTool({
      id: "gitLog",
      description: "List recent commits (short hash, author, date, message).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().default(10),
      }),
      execute: async ({ limit }) => {
        try {
          await requireRepo();
          const commits = await readLog(git, limit);
          return { count: commits.length, commits };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),

    gitCommit: createTool({
      id: "gitCommit",
      description:
        "Stage the given files and create a git commit containing exactly those files. Write a concise conventional-style message; never commit unrelated files.",
      inputSchema: z.object({
        files: z.array(z.string().min(1)).min(1).max(200).describe("Workspace-relative file paths to commit"),
        message: z.string().trim().min(3).max(500),
      }),
      execute: async ({ files, message }) => {
        try {
          await requireRepo();
          const { commit, summary } = await commitPaths(git, run.workspacePath, files, message);
          return { commit, files, summary };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),

    gitBranch: createTool({
      id: "gitBranch",
      description: "List local branches and mark the current one.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          await requireRepo();
          const branches = await git.branchLocal();
          return { current: branches.current, branches: branches.all };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),

    gitCheckout: createTool({
      id: "gitCheckout",
      description: "Switch to an existing local branch, or create it with create=true. Uncommitted conflicting changes will make git refuse; resolve or stash first.",
      inputSchema: z.object({
        name: z.string().regex(BRANCH_NAME_PATTERN, "Invalid branch name"),
        create: z.boolean().optional().describe("Create the branch before switching to it"),
      }),
      execute: async ({ name, create }) => {
        try {
          await requireRepo();
          if (create) await git.checkoutLocalBranch(name);
          else await git.checkout(name);
          return { branch: name, created: Boolean(create) };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),

    gitPull: createTool({
      id: "gitPull",
      description:
        "Pull with fast-forward only. Diverged branches are reported instead of merged; the user resolves them manually.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          await requireRepo();
          const result = await git.pull({ "--ff-only": null });
          return {
            files: result.files,
            insertions: result.summary.insertions,
            deletions: result.summary.deletions,
          };
        } catch (error) {
          return {
            error:
              `${errorMessage(error)} ` +
              `(fast-forward only; if branches diverged, ask the user how to proceed)`.trim(),
          };
        }
      },
    }),

    gitPush: createTool({
      id: "gitPush",
      description:
        "Push the current branch to its upstream. Authentication uses the system git credentials; requires explicit user approval.",
      inputSchema: z.object({
        setUpstream: z
          .boolean()
          .optional()
          .describe("Set the upstream when the branch has none (push -u origin <branch>)"),
      }),
      execute: async ({ setUpstream }) => {
        try {
          await requireRepo();
          const branch = (await git.branchLocal()).current;
          const result = setUpstream
            ? await git.push("origin", branch, { "--set-upstream": null })
            : await git.push();
          return { pushed: result.pushed, branch, remote: "origin" };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    }),
  };
}

/** Git tools for in-conversation version control. Read tools are approval-free;
 * commit/checkout/pull need approval; gitPush stays high-risk and is re-gated
 * by policies even in relaxed permission modes. */
export class GitToolProvider implements ToolProvider {
  readonly id = "git";
  readonly label = "Git 工具";

  listTools(): ToolDescriptor[] {
    const read = {
      risk: "low" as const,
      mutating: false,
      defaultPolicy: { enabled: true, requireApproval: false },
      providerId: this.id,
    };
    const write = {
      risk: "medium" as const,
      mutating: true,
      defaultPolicy: { enabled: true, requireApproval: true },
      providerId: this.id,
    };
    return [
      { ...read, name: "gitStatus", label: "Git status", description: "Show branch and pending changes." },
      { ...read, name: "gitDiff", label: "Git diff", description: "Show a unified diff of git changes." },
      { ...read, name: "gitLog", label: "Git log", description: "List recent commits." },
      { ...read, name: "gitBranch", label: "Git branches", description: "List local branches." },
      { ...write, name: "gitCommit", label: "Git commit", description: "Stage files and create a commit." },
      { ...write, name: "gitCheckout", label: "Git checkout", description: "Switch or create a branch." },
      { ...write, name: "gitPull", label: "Git pull", description: "Fast-forward pull from upstream." },
      {
        name: "gitPush",
        label: "Git push",
        description: "Push the current branch to origin.",
        risk: "high",
        mutating: true,
        defaultPolicy: { enabled: true, requireApproval: true },
        providerId: this.id,
      },
    ];
  }

  createTools(run: RunContext): Record<string, RuntimeTool> {
    return createGitTools(run);
  }
}
