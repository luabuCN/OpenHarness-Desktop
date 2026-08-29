import path from "node:path";
import { createTool, type ToolAction } from "@mastra/core/tools";
import { z } from "zod";
import { config, workspaceDir } from "../env.js";
import { FileTooLargeError, SafeFsProvider, SafeShellProvider } from "../safe-fs.js";
import { taskService } from "./task-service.js";
import { TOOL_CATALOG, type ToolPermissionMap, type ToolPolicy } from "./tool-catalog.js";

export type RuntimeTool = ToolAction<any, any, any, any, any>;

export type ApprovalDecision =
  | { kind: "approved"; approvalId?: string }
  | { kind: "rejected"; reason?: string }
  | { kind: "timeout" }
  | { kind: "aborted" };

export interface ApprovalBridge {
  request(toolName: string, input: string): Promise<ApprovalDecision>;
}

export interface ToolRegistryOptions {
  rootPath?: string;
  enableBash?: boolean;
  approvals?: ApprovalBridge;
  bashApprovals?: ApprovalBridge;
  toolPermissions?: ToolPermissionMap;
  taskContext?: {
    conversationId: string;
    runId?: string;
  };
}

async function requestApproval(
  approvals: ApprovalBridge | undefined,
  toolName: string,
  input: unknown,
) {
  if (!approvals) {
    throw new Error(`${toolName} requires approval, but no approval bridge is available.`);
  }
  const decision = await approvals.request(
    toolName,
    JSON.stringify(input, null, 2).slice(0, 20_000),
  );
  if (decision.kind === "approved") return;
  if (decision.kind === "aborted") {
    throw new Error(`${toolName} approval was cancelled because the run stopped.`);
  }
  if (decision.kind === "timeout") {
    throw new Error(`${toolName} approval timed out.`);
  }
  throw new Error(
    decision.reason
      ? `User rejected ${toolName}: ${decision.reason}`
      : `User rejected ${toolName}.`,
  );
}

function previewText(value: string, maxLength = 4_000): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n... (${value.length - maxLength} more characters)`;
}

type ToolSource = "builtin" | "workspace";

interface ToolRegistration {
  name: string;
  source: ToolSource;
  tool: RuntimeTool;
}

const DEFAULT_MAX_LINES = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1_024;
const DEFAULT_MAX_LINE_LENGTH = 2_000;
const MAX_WRITE_BYTES = 10 * 1_024 * 1_024;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".exe", ".dll",
  ".so", ".dylib", ".bin", ".obj", ".o", ".a", ".lib", ".png", ".jpg",
  ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif", ".mp3",
  ".mp4", ".avi", ".mov", ".wav", ".flac", ".ogg", ".webm", ".mkv",
  ".pdf", ".wasm", ".class", ".jar", ".pyc", ".pyd", ".whl",
  ".ttf", ".otf", ".woff", ".woff2", ".eot", ".sqlite", ".db",
]);

export const workspaceFileProvider = new SafeFsProvider(workspaceDir);

function createReadFileTool(fsProvider: SafeFsProvider): RuntimeTool {
  return createTool({
    id: "readFile",
    description:
      "Read text file contents with line numbers. Use offset and limit for large files.",
    inputSchema: z.object({
      filePath: z.string().describe("Workspace-relative or absolute path"),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(DEFAULT_MAX_LINES).optional(),
    }),
    execute: async ({ filePath, offset, limit }) => {
      const resolved = fsProvider.resolvePath(filePath);
      if (isBinaryPath(resolved)) return { error: `Cannot read binary file: ${resolved}` };

      let content: string;
      try {
        content = await fsProvider.readFile(resolved);
      } catch (error) {
        if (error instanceof FileTooLargeError) return { error: error.message };
        throw error;
      }

      const lines = content.split("\n");
      const start = Math.max((offset ?? 1) - 1, 0);
      const end = Math.min(start + (limit ?? DEFAULT_MAX_LINES), lines.length);
      const bounded: string[] = [];
      let bytes = 0;
      let truncatedByBytes = false;

      for (let index = start; index < end; index += 1) {
        const rendered = `${index + 1}: ${truncateText(lines[index], DEFAULT_MAX_LINE_LENGTH)}`;
        const nextBytes = Buffer.byteLength(rendered, "utf8") + 1;
        if (bytes + nextBytes > DEFAULT_MAX_OUTPUT_BYTES) {
          truncatedByBytes = true;
          break;
        }
        bytes += nextBytes;
        bounded.push(rendered);
      }

      const lastLine = start + bounded.length;
      return {
        filePath: resolved,
        totalLines: lines.length,
        fromLine: start + 1,
        toLine: lastLine,
        status: buildContinuationStatus({
          total: lines.length,
          shownThrough: lastLine,
          truncated: truncatedByBytes,
          continuationLabel: "lines",
        }),
        content: bounded.join("\n"),
      };
    },
  });
}

function createListFilesTool(fsProvider: SafeFsProvider): RuntimeTool {
  return createTool({
    id: "listFiles",
    description: "List directory entries, optionally recursively.",
    inputSchema: z.object({
      dirPath: z.string().optional().default("."),
      recursive: z.boolean().optional().default(false),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(DEFAULT_MAX_LINES).optional(),
    }),
    execute: async ({ dirPath, recursive, offset, limit }) => {
      const resolved = fsProvider.resolvePath(dirPath);
      const entries = recursive
        ? await walkDirectory(fsProvider, resolved, resolved)
        : (await fsProvider.readdir(resolved)).map((entry) => ({
            relativePath: entry.name,
            isDirectory: entry.isDirectory,
          }));

      const page = paginate(entries, offset, limit, DEFAULT_MAX_OUTPUT_BYTES);
      return {
        dirPath: resolved,
        count: page.items.length,
        totalCount: entries.length,
        fromEntry: page.from,
        toEntry: page.to,
        status: buildContinuationStatus({
          total: entries.length,
          shownThrough: page.to,
          truncated: page.truncated,
          continuationLabel: "entries",
          emptyMessage: "Directory is empty.",
        }),
        entries: page.items.map(({ relativePath, isDirectory }) => ({
          name: relativePath,
          type: isDirectory ? "directory" : "file",
        })),
      };
    },
  });
}

function createGlobTool(fsProvider: SafeFsProvider): RuntimeTool {
  return createTool({
    id: "glob",
    description:
      "Find paths by glob pattern. Examples: src/**/*.ts, docs/*.md, package.json.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      dirPath: z.string().optional().default("."),
      limit: z.number().int().min(1).max(DEFAULT_MAX_LINES).optional(),
    }),
    execute: async ({ pattern, dirPath, limit }) => {
      const root = fsProvider.resolvePath(dirPath);
      const matcher = compileGlob(pattern.replaceAll("\\", "/"));
      const files = await walkFiles(fsProvider, root);
      const matches: Array<{ path: string }> = [];

      for (const file of files) {
        const relative = path.relative(root, file).replaceAll("\\", "/");
        if (!matcher(relative)) continue;
        if (matches.length >= (limit ?? DEFAULT_MAX_LINES)) {
          return { pattern, count: matches.length, truncated: true, matches };
        }
        matches.push({ path: relative });
      }

      return { pattern, count: matches.length, truncated: false, matches };
    },
  });
}

function createGrepTool(fsProvider: SafeFsProvider): RuntimeTool {
  return createTool({
    id: "grep",
    description:
      "Search file contents with a regular expression and return matching lines.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      dirPath: z.string().optional().default("."),
      glob: z.string().optional(),
      ignoreCase: z.boolean().optional().default(false),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(DEFAULT_MAX_LINES).optional(),
    }),
    execute: async ({ pattern, dirPath, glob, ignoreCase, offset, limit }) => {
      const root = fsProvider.resolvePath(dirPath);
      const regex = new RegExp(pattern, ignoreCase ? "i" : "");
      const globMatcher = glob ? compileGlob(glob.replaceAll("\\", "/")) : () => true;
      const files = await walkFiles(fsProvider, root);
      const matches: Array<{ file: string; line: number; content: string }> = [];
      const matchLimit = limit ?? DEFAULT_MAX_LINES;
      let matchCount = 0;
      let bytes = 0;
      let truncatedByBytes = false;

      for (const file of files) {
        const relative = path.relative(root, file).replaceAll("\\", "/");
        if (isBinaryPath(file) || !globMatcher(relative)) continue;

        let content: string;
        try {
          content = await fsProvider.readFile(file);
        } catch {
          continue;
        }

        for (const [lineIndex, rawLine] of content.split("\n").entries()) {
          if (!regex.test(rawLine)) continue;
          matchCount += 1;
          if (matchCount < (offset ?? 1) || matches.length >= matchLimit) continue;

          const match = {
            file: relative,
            line: lineIndex + 1,
            content: truncateText(rawLine, DEFAULT_MAX_LINE_LENGTH),
          };
          const matchBytes = Buffer.byteLength(JSON.stringify(match), "utf8");
          if (bytes + matchBytes > DEFAULT_MAX_OUTPUT_BYTES) {
            truncatedByBytes = true;
            continue;
          }
          bytes += matchBytes;
          matches.push(match);
        }
      }

      const startOffset = Math.max((offset ?? 1) - 1, 0);
      return {
        pattern,
        matchCount,
        fromMatch: matches.length > 0 ? startOffset + 1 : 0,
        toMatch: startOffset + matches.length,
        truncatedByBytes,
        status: matchCount === 0 ? "No matches found." : undefined,
        matches,
      };
    },
  });
}

function createWriteFileTool(
  fsProvider: SafeFsProvider,
  approvals: ApprovalBridge | undefined,
  policy: ToolPolicy,
): RuntimeTool {
  return createTool({
    id: "writeFile",
    description:
      "Create a UTF-8 text file or completely replace an existing one. Prefer editFile for small changes.",
    inputSchema: z.object({
      filePath: z.string().min(1),
      content: z.string().describe("The full file contents to write"),
    }),
    execute: async ({ filePath, content }) => {
      if (policy.requireApproval) {
        await requestApproval(approvals, "writeFile", {
          filePath,
          byteCount: Buffer.byteLength(content, "utf8"),
          contentPreview: previewText(content),
        });
      }
      if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
        return { error: `Content exceeds the ${formatBytes(MAX_WRITE_BYTES)} write limit.` };
      }
      const resolved = fsProvider.resolvePath(filePath);
      await fsProvider.writeFile(resolved, content);
      return {
        filePath: resolved,
        bytesWritten: Buffer.byteLength(content, "utf8"),
        lines: content.split("\n").length,
      };
    },
  });
}

function createEditFileTool(
  fsProvider: SafeFsProvider,
  approvals: ApprovalBridge | undefined,
  policy: ToolPolicy,
): RuntimeTool {
  return createTool({
    id: "editFile",
    description:
      "Replace exact occurrences in a UTF-8 text file. Include enough surrounding text to make replacements unambiguous.",
    inputSchema: z.object({
      filePath: z.string().min(1),
      oldString: z.string().min(1),
      newString: z.string(),
      expectedReplacements: z.number().int().min(1).max(100).optional()
        .describe("Number of exact occurrences to replace; defaults to 1"),
    }),
    execute: async ({ filePath, oldString, newString, expectedReplacements = 1 }) => {
      if (policy.requireApproval) {
        await requestApproval(approvals, "editFile", {
          filePath,
          expectedReplacements,
          oldStringPreview: previewText(oldString),
          newStringPreview: previewText(newString),
        });
      }
      const resolved = fsProvider.resolvePath(filePath);
      if (isBinaryPath(resolved)) return { error: "editFile cannot modify binary files." };
      const original = await fsProvider.readFile(resolved).catch(() => null);
      if (original === null) return { error: `File does not exist or cannot be read: ${resolved}` };

      const occurrences = original.split(oldString).length - 1;
      if (occurrences === 0) return { error: "oldString was not found." };
      if (occurrences !== expectedReplacements) {
        return {
          error: `oldString matched ${occurrences} time(s), expected ${expectedReplacements}. Add surrounding context.`,
          occurrences,
        };
      }

      const updated =
        expectedReplacements === 1
          ? original.replace(oldString, () => newString)
          : original.replaceAll(oldString, () => newString);
      if (Buffer.byteLength(updated, "utf8") > MAX_WRITE_BYTES) {
        return { error: `Updated file exceeds the ${formatBytes(MAX_WRITE_BYTES)} limit.` };
      }

      await fsProvider.writeFile(resolved, updated);
      return {
        filePath: resolved,
        replacements: expectedReplacements,
        oldLength: Buffer.byteLength(original, "utf8"),
        newLength: Buffer.byteLength(updated, "utf8"),
      };
    },
  });
}

function createMkdirTool(
  fsProvider: SafeFsProvider,
  approvals: ApprovalBridge | undefined,
  policy: ToolPolicy,
): RuntimeTool {
  return createTool({
    id: "mkdir",
    description: "Create a directory and missing parent directories.",
    inputSchema: z.object({ dirPath: z.string().min(1) }),
    execute: async ({ dirPath }) => {
      if (policy.requireApproval) {
        await requestApproval(approvals, "mkdir", { dirPath });
      }
      const resolved = fsProvider.resolvePath(dirPath);
      await fsProvider.mkdir(resolved, { recursive: true });
      return { dirPath: resolved };
    },
  });
}

function createBashTool(options: {
  rootPath: string;
  approvals?: ApprovalBridge;
  policy: ToolPolicy;
}): RuntimeTool {
  const shellProvider = new SafeShellProvider(options.rootPath);
  return createTool({
    id: "bash",
    description:
      "Execute a shell command in the project workspace. Commands wait for explicit user approval before execution. Uses PowerShell on Windows and Bash elsewhere.",
    inputSchema: z.object({
      command: z.string().min(1),
      timeout: z.number().int().min(1_000).max(300_000).optional().default(30_000),
    }),
    execute: async ({ command, timeout }) => {
      if (!options.approvals && !config.enableBash) {
        return { error: "Bash is disabled for this agent run." };
      }
      if (options.policy.requireApproval) {
        await requestApproval(options.approvals, "bash", { command, timeout });
      }
      return shellProvider.exec(command, { timeout });
    },
  });
}

const announceTool = createTool({
  id: "announce",
  description: "Narrate current progress with a short status message.",
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => message,
});

function createTaskTools(context: NonNullable<ToolRegistryOptions["taskContext"]>): Record<string, RuntimeTool> {
  const taskId = z.string().regex(/^\d+$/).describe("Task ID, for example 1");

  return {
    TaskCreate: createTool({
      id: "TaskCreate",
      description:
        "Create a persistent task for a complex multi-step request. Check TaskList first to avoid duplicates.",
      inputSchema: z.object({
        subject: z.string().min(1).max(300).describe("Short imperative title"),
        description: z.string().max(4_000).optional().describe("Requirements and acceptance criteria"),
        activeForm: z.string().max(200).optional().describe("Present-progressive status label"),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }).strict(),
      execute: async (input) => {
        try {
          const task = await taskService.create({ ...input, ...context });
          return { task };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    TaskGet: createTool({
      id: "TaskGet",
      description: "Get one task, including its description, owner, and dependencies.",
      inputSchema: z.object({ taskId }).strict(),
      execute: async ({ taskId: id }) => {
        try {
          return { task: await taskService.get(context.conversationId, id) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    TaskList: createTool({
      id: "TaskList",
      description: "List persistent tasks for this conversation.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        try {
          const tasks = await taskService.list(context.conversationId);
          return { count: tasks.length, tasks };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    TaskUpdate: createTool({
      id: "TaskUpdate",
      description:
        "Update task status or details and add dependencies. Mark completed only after the work is verified.",
      inputSchema: z.object({
        taskId,
        subject: z.string().min(1).max(300).optional(),
        description: z.string().max(4_000).optional(),
        activeForm: z.string().max(200).optional(),
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
        owner: z.string().max(120).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        addBlockedBy: z.array(taskId).max(100).optional(),
        addBlocks: z.array(taskId).max(100).optional(),
      }).strict(),
      execute: async ({ taskId: id, ...input }) => {
        try {
          return { task: await taskService.update(context.conversationId, id, input) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolRegistration>();

  register(source: ToolSource, tools: Record<string, RuntimeTool>): void {
    for (const [name, tool] of Object.entries(tools)) {
      this.tools.set(name, { name, source, tool });
    }
  }

  get size(): number {
    return this.tools.size;
  }

  list(): Array<Pick<ToolRegistration, "name" | "source">> {
    return [...this.tools.values()].map(({ name, source }) => ({ name, source }));
  }

  toToolSet(): Record<string, RuntimeTool> {
    return Object.fromEntries([...this.tools.values()].map(({ name, tool }) => [name, tool]));
  }
}

export function createToolRegistry(options: ToolRegistryOptions & { readOnly?: boolean } = {}): ToolRegistry {
  const rootPath = options.rootPath ?? workspaceDir;
  const fsProvider = new SafeFsProvider(rootPath);
  const registry = new ToolRegistry();
  const approvals = options.approvals ?? options.bashApprovals;
  const policyFor = (name: string): ToolPolicy => {
    const entry = TOOL_CATALOG.find((tool) => tool.name === name);
    const base: ToolPolicy = entry
      ? { ...entry.defaultPolicy }
      : { enabled: true, requireApproval: false };
    if (options.readOnly && entry?.mutating) return { enabled: false, requireApproval: false };
    const override = options.toolPermissions?.[name];
    return {
      enabled: override?.enabled ?? base.enabled,
      requireApproval: override?.requireApproval ?? base.requireApproval,
    };
  };
  const filterTools = (
    tools: Record<string, RuntimeTool>,
  ): Record<string, RuntimeTool> =>
    Object.fromEntries(
      Object.entries(tools).filter(([name]) => policyFor(name).enabled || (name === "bash" && options.enableBash === true)),
    );

  registry.register("builtin", filterTools({
    announce: announceTool,
    readFile: createReadFileTool(fsProvider),
    listFiles: createListFilesTool(fsProvider),
    glob: createGlobTool(fsProvider),
    grep: createGrepTool(fsProvider),
    ...(options.taskContext ? createTaskTools(options.taskContext) : {}),
  }));

  registry.register("workspace", filterTools({
    writeFile: createWriteFileTool(fsProvider, approvals, policyFor("writeFile")),
    editFile: createEditFileTool(fsProvider, approvals, policyFor("editFile")),
    mkdir: createMkdirTool(fsProvider, approvals, policyFor("mkdir")),
    bash: createBashTool({
      rootPath,
      approvals,
      policy: {
        ...policyFor("bash"),
        enabled: policyFor("bash").enabled || Boolean(options.enableBash),
      },
    }),
  }));

  return registry;
}

async function walkDirectory(
  fsProvider: SafeFsProvider,
  root: string,
  current: string,
): Promise<Array<{ relativePath: string; isDirectory: boolean }>> {
  const entries = await fsProvider.readdir(current);
  const result: Array<{ relativePath: string; isDirectory: boolean }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    result.push({
      relativePath: path.relative(root, absolutePath).replaceAll("\\", "/"),
      isDirectory: entry.isDirectory,
    });
    if (entry.isDirectory && !SKIP_DIRS.has(entry.name)) {
      result.push(...(await walkDirectory(fsProvider, root, absolutePath)));
    }
  }

  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walkFiles(fsProvider: SafeFsProvider, root: string): Promise<string[]> {
  const directories = await walkDirectory(fsProvider, root, root);
  return directories
    .filter((entry) => !entry.isDirectory)
    .map((entry) => path.join(root, entry.relativePath));
}

function paginate<T>(items: T[], offset?: number, limit?: number, byteLimit?: number) {
  const start = Math.max((offset ?? 1) - 1, 0);
  const cappedLimit = limit ?? DEFAULT_MAX_LINES;
  const limited: T[] = [];
  let bytes = 0;
  let truncated = false;

  for (const item of items.slice(start)) {
    if (limited.length >= cappedLimit) {
      truncated = true;
      break;
    }
    const itemBytes = byteLimit ? Buffer.byteLength(JSON.stringify(item), "utf8") : 0;
    if (byteLimit && bytes + itemBytes > byteLimit) {
      truncated = true;
      break;
    }
    bytes += itemBytes;
    limited.push(item);
  }

  return {
    items: limited,
    from: limited.length > 0 ? start + 1 : 0,
    to: start + limited.length,
    truncated,
  };
}

function compileGlob(pattern: string): (filePath: string) => boolean {
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") return "(?:[^/]+/)*[^/]+";
      return segment
        .replaceAll(/[.+^${}()[\]\\]/g, "\\$&")
        .replaceAll("**", "\u0000")
        .replaceAll("*", "[^/]*")
        .replaceAll("\u0000", ".*")
        .replaceAll("?", "[^/]");
    })
    .join("/");
  const matcher = new RegExp(`^${source}$`);
  return (filePath) => matcher.test(filePath);
}

function buildContinuationStatus(input: {
  total: number;
  shownThrough: number;
  truncated: boolean;
  continuationLabel: string;
  emptyMessage?: string;
}): string {
  if (input.total === 0) return input.emptyMessage ?? `No ${input.continuationLabel}.`;
  if (input.shownThrough < input.total || input.truncated) {
    return `Showing ${input.continuationLabel} through ${input.shownThrough} of ${input.total}. Continue with the next offset.`;
  }
  return `End of results -- ${input.total} ${input.continuationLabel} total.`;
}

function truncateText(text: string, maxLength: number): string {
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}... (line truncated at ${maxLength} chars)`;
}

function isBinaryPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension !== "" && BINARY_EXTENSIONS.has(extension);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
