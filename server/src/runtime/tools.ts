import path from "node:path";
import { createTool, type ToolAction } from "@mastra/core/tools";
import { z } from "zod";
import { config, workspaceDir } from "../env.js";
import { SafeFsProvider, SafeShellProvider } from "../safe-fs.js";

export type RuntimeTool = ToolAction<any, any, any, any, any>;

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024;
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_LINE_LENGTH = 2000;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".exe", ".dll",
  ".so", ".dylib", ".bin", ".obj", ".o", ".a", ".lib", ".png", ".jpg",
  ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif", ".mp3",
  ".mp4", ".avi", ".mov", ".wav", ".flac", ".ogg", ".webm", ".mkv",
  ".pdf", ".wasm", ".class", ".jar", ".pyc", ".pyd", ".pyo", ".whl",
  ".egg", ".ttf", ".otf", ".woff", ".woff2", ".eot", ".sqlite", ".db",
  ".DS_Store",
]);

export const fsProvider = new SafeFsProvider(workspaceDir);
const shellProvider = new SafeShellProvider(workspaceDir);

const readFile = createTool({
  id: "readFile",
  description:
    "Read the contents of a file. Returns the text content with line numbers. " +
    "For large files, use offset and limit to read specific line ranges.",
  inputSchema: z.object({
    filePath: z.string().describe("Absolute or relative path to the file"),
    offset: z.number().int().min(1).optional().describe("1-based line number to start reading from"),
    limit: z.number().int().min(1).optional().describe(`Maximum number of lines to return (default ${DEFAULT_MAX_LINES})`),
  }),
  execute: async ({ filePath, offset, limit }) => {
    const resolved = fsProvider.resolvePath(filePath);
    if (isBinaryPath(resolved)) return { error: `Cannot read binary file: ${resolved}` };

    let content: string;
    try {
      content = await fsProvider.readFile(resolved);
    } catch (error) {
      if (error instanceof Error && error.name === "FileTooLargeError") {
        return { error: error.message };
      }
      throw error;
    }

    const allLines = content.split("\n");
    const totalLines = allLines.length;
    const start = (offset ?? 1) - 1;
    if (start > 0 && start >= totalLines) {
      return {
        error: `Offset ${offset} is out of range (file has ${totalLines} lines)`,
        filePath: resolved,
      };
    }

    const end = Math.min(start + (limit ?? DEFAULT_MAX_LINES), totalLines);
    const slice = allLines.slice(start, end);
    let totalBytes = 0;
    let truncatedByBytes = false;
    const outputLines: string[] = [];

    for (const [index, rawLine] of slice.entries()) {
      const line =
        rawLine.length > DEFAULT_MAX_LINE_LENGTH
          ? rawLine.slice(0, DEFAULT_MAX_LINE_LENGTH) +
            `... (line truncated at ${DEFAULT_MAX_LINE_LENGTH} chars)`
          : rawLine;
      const lineBytes = Buffer.byteLength(line, "utf-8");
      if (totalBytes + lineBytes > DEFAULT_MAX_OUTPUT_BYTES) {
        truncatedByBytes = true;
        break;
      }
      totalBytes += lineBytes;
      outputLines.push(`${start + index + 1}: ${line}`);
    }

    const lastLine = start + outputLines.length;
    const status = truncatedByBytes
      ? `Output capped at ${formatBytes(DEFAULT_MAX_OUTPUT_BYTES)}. Showing lines ${start + 1}-${lastLine} of ${totalLines}. Use offset=${lastLine + 1} to continue.`
      : lastLine < totalLines
        ? `Showing lines ${start + 1}-${lastLine} of ${totalLines}. Use offset=${lastLine + 1} to continue.`
        : `End of file -- ${totalLines} lines total.`;

    return {
      filePath: resolved,
      totalLines,
      fromLine: start + 1,
      toLine: lastLine,
      status,
      content: outputLines.join("\n"),
    };
  },
});

const listFiles = createTool({
  id: "listFiles",
  description:
    "List files and directories at the given path. Set recursive to true to walk subdirectories. " +
    "Large results are paginated automatically; use offset and limit to continue.",
  inputSchema: z.object({
    dirPath: z.string().optional().default(".").describe("Directory path to list (defaults to workspace root)"),
    recursive: z.boolean().optional().default(false).describe("Recursively list all entries"),
    offset: z.number().int().min(1).optional().describe("1-based entry number to start listing from"),
    limit: z.number().int().min(1).optional().describe(`Maximum number of entries to return (default ${DEFAULT_MAX_LINES})`),
  }),
  execute: async ({ dirPath, recursive, offset, limit }) => {
    const resolved = fsProvider.resolvePath(dirPath);
    const entries = recursive
      ? (await walkDirectory(resolved, resolved)).map((entry) => ({
          name: entry.relativePath,
          type: entry.isDirectory ? "directory" : "file",
        }))
      : (await fsProvider.readdir(resolved)).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory ? "directory" : "file",
        }));
    const totalCount = entries.length;
    const start = (offset ?? 1) - 1;
    if (start > 0 && start >= totalCount) {
      return {
        error: `Offset ${offset} is out of range (listing has ${totalCount} entries)`,
        dirPath: resolved,
      };
    }

    const end = Math.min(start + (limit ?? DEFAULT_MAX_LINES), totalCount);
    const page = entries.slice(start, end);
    const { items, truncatedByBytes } = takeItemsWithinByteLimit(page, DEFAULT_MAX_OUTPUT_BYTES);
    const fromEntry = items.length > 0 ? start + 1 : 0;
    const toEntry = start + items.length;
    const status =
      totalCount === 0
        ? "Directory is empty."
        : truncatedByBytes
          ? `Output capped at ${formatBytes(DEFAULT_MAX_OUTPUT_BYTES)}. Showing entries ${fromEntry}-${toEntry} of ${totalCount}. Use offset=${toEntry + 1} to continue.`
          : toEntry < totalCount
            ? `Showing entries ${fromEntry}-${toEntry} of ${totalCount}. Use offset=${toEntry + 1} to continue.`
            : `End of listing -- ${totalCount} entries total.`;

    return {
      dirPath: resolved,
      count: items.length,
      totalCount,
      fromEntry,
      toEntry,
      status,
      entries: items,
    };
  },
});

const grep = createTool({
  id: "grep",
  description:
    "Search file contents with a regex pattern. Searches recursively from the given directory, " +
    "skipping node_modules and .git. Returns matching lines with file paths and line numbers.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    dirPath: z.string().optional().default(".").describe("Root directory to search from"),
    glob: z.string().optional().describe("Only search files matching this file suffix (e.g. '.ts')"),
    ignoreCase: z.boolean().optional().default(false).describe("Case-insensitive matching"),
    offset: z.number().int().min(1).optional().describe("1-based match number to start returning from"),
    limit: z.number().int().min(1).optional().describe(`Maximum number of matches to return (default ${DEFAULT_MAX_LINES})`),
  }),
  execute: async ({ pattern, dirPath, glob, ignoreCase, offset, limit }) => {
    const resolved = fsProvider.resolvePath(dirPath);
    const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
    const files = (await walkFiles(resolved)).filter((file) => !glob || file.endsWith(glob));
    const matches: Array<{ file: string; line: number; content: string }> = [];
    const start = (offset ?? 1) - 1;
    const matchLimit = limit ?? DEFAULT_MAX_LINES;
    let matchCount = 0;
    let totalBytes = 0;
    let truncatedByBytes = false;

    for (const file of files) {
      if (isBinaryPath(file)) continue;
      let content: string;
      try {
        content = await fsProvider.readFile(file);
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (const [index, rawLine] of lines.entries()) {
        if (!regex.test(rawLine)) continue;
        matchCount += 1;
        if (matchCount <= start || truncatedByBytes || matches.length >= matchLimit) continue;

        const line =
          rawLine.length > DEFAULT_MAX_LINE_LENGTH
            ? rawLine.slice(0, DEFAULT_MAX_LINE_LENGTH) +
              `... (line truncated at ${DEFAULT_MAX_LINE_LENGTH} chars)`
            : rawLine;
        const match = {
          file: path.relative(resolved, file),
          line: index + 1,
          content: line,
        };
        const matchBytes = Buffer.byteLength(JSON.stringify(match), "utf-8");
        if (totalBytes + matchBytes > DEFAULT_MAX_OUTPUT_BYTES) {
          truncatedByBytes = true;
          continue;
        }
        totalBytes += matchBytes;
        matches.push(match);
      }
    }

    if (start > 0 && start >= matchCount) {
      return {
        error: `Offset ${offset} is out of range (${matchCount} matches found)`,
        dirPath: resolved,
        pattern,
        matchCount,
      };
    }

    const fromMatch = matches.length > 0 ? start + 1 : 0;
    const toMatch = start + matches.length;
    const status =
      matchCount === 0
        ? `No matches found for /${pattern}/.`
        : truncatedByBytes
          ? `Output capped at ${formatBytes(DEFAULT_MAX_OUTPUT_BYTES)}. Showing matches ${fromMatch}-${toMatch} of ${matchCount}. Use offset=${toMatch + 1} to continue.`
          : toMatch < matchCount
            ? `Showing matches ${fromMatch}-${toMatch} of ${matchCount}. Use offset=${toMatch + 1} to continue.`
            : `End of matches -- ${matchCount} total.`;

    return {
      dirPath: resolved,
      pattern,
      matchCount,
      fromMatch,
      toMatch,
      status,
      matches,
    };
  },
});

const bash = createTool({
  id: "bash",
  description:
    "Run a bash command and return its output. Use this for git operations, running tests, " +
    "building projects, and other shell tasks. Commands run in the workspace.",
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
    timeout: z.number().int().min(1000).max(300000).optional().default(30000).describe("Timeout in milliseconds"),
  }),
  execute: async ({ command, timeout }) => shellProvider.exec(command, { timeout }),
});

export const announceTool = createTool({
  id: "announce",
  description: "Narrate current progress with a short status message.",
  inputSchema: z.object({
    message: z.string().describe("A short status update"),
  }),
  execute: async ({ message }) => message,
});

export type ToolSource = "builtin" | "workspace";

export interface ToolRegistration {
  name: string;
  source: ToolSource;
  tool: RuntimeTool;
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

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register("builtin", { readFile, listFiles, grep, announce: announceTool });
  if (config.enableBash) registry.register("workspace", { bash });
  return registry;
}

async function walkDirectory(
  root: string,
  dir: string,
): Promise<Array<{ relativePath: string; isDirectory: boolean }>> {
  const entries = await fsProvider.readdir(dir);
  const results: Array<{ relativePath: string; isDirectory: boolean }> = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    results.push({ relativePath: path.relative(root, absolutePath), isDirectory: entry.isDirectory });
    if (entry.isDirectory && !SKIP_DIRS.has(entry.name)) {
      results.push(...(await walkDirectory(root, absolutePath)));
    }
  }
  return results;
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await fsProvider.readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...(await walkFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

function takeItemsWithinByteLimit(items: Array<{ name: string; type: string }>, maxBytes: number) {
  let totalBytes = 0;
  const limitedItems: typeof items = [];
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf-8");
    if (totalBytes + itemBytes > maxBytes) return { items: limitedItems, truncatedByBytes: true };
    totalBytes += itemBytes;
    limitedItems.push(item);
  }
  return { items: limitedItems, truncatedByBytes: false };
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
