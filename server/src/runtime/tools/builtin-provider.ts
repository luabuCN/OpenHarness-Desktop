import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { SafeFsProvider } from "../../safe-fs.js";
import type { RunContext } from "./run-context.js";
import type { ToolDescriptor, ToolProvider } from "./registry.js";
import type { RuntimeTool } from "./types.js";
import {
  buildContinuationStatus,
  compileGlob,
  DEFAULT_MAX_LINE_LENGTH,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_OUTPUT_BYTES,
  isBinaryPath,
  paginate,
  truncateText,
  walkDirectory,
  walkFiles,
} from "./fs-utils.js";
import { FileTooLargeError } from "../../safe-fs.js";
import { extractDocumentText, isDocumentPath } from "./document-extract.js";

const announceTool = createTool({
  id: "announce",
  description: "Narrate current progress with a short status message.",
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => message,
});

function createReadFileTool(fsProvider: SafeFsProvider): RuntimeTool {
  return createTool({
    id: "readFile",
    description:
      "Read text file contents with line numbers. Use offset and limit for large files. PDF/Word/Excel (.pdf/.docx/.xlsx/.pptx) attachments are supported: their text is extracted automatically.",
    inputSchema: z.object({
      filePath: z.string().describe("Workspace-relative or absolute path"),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(DEFAULT_MAX_LINES).optional(),
    }),
    execute: async ({ filePath, offset, limit }) => {
      const resolved = fsProvider.resolvePath(filePath);
      // 文档附件（PDF/Word/表格）先做文本提取，再走统一的行分页输出。
      if (isDocumentPath(resolved)) {
        try {
          const extracted = await extractDocumentText(resolved);
          if (extracted.text.length === 0) {
            return { error: `No extractable text found in document: ${resolved}` };
          }
          const lines = extracted.text.split("\n");
          const start = Math.max((offset ?? 1) - 1, 0);
          const end = Math.min(start + (limit ?? DEFAULT_MAX_LINES), lines.length);
          return {
            filePath: resolved,
            totalLines: lines.length,
            fromLine: start + 1,
            toLine: end,
            truncated: extracted.truncated,
            status: buildContinuationStatus({
              total: lines.length,
              shownThrough: end,
              truncated: extracted.truncated,
              continuationLabel: "lines",
            }),
            note: `Extracted ${path.extname(resolved).toLowerCase().slice(1)} text (formatting/graphics not preserved)`,
            content: lines
              .slice(start, end)
              .map((line, index) => `${start + index + 1}: ${truncateText(line, DEFAULT_MAX_LINE_LENGTH)}`)
              .join("\n"),
          };
        } catch (error) {
          return {
            error: `Failed to extract document text from ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
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

/** Read-only workspace tools available to every agent. */
export class BuiltinToolProvider implements ToolProvider {
  readonly id = "builtin";
  readonly label = "基础工具";

  listTools(): ToolDescriptor[] {
    return [
      {
        name: "announce",
        label: "Announce",
        description: "Report short progress updates during multi-step work.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "readFile",
        label: "Read file",
        description: "Read bounded text file contents with line numbers.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "listFiles",
        label: "List files",
        description: "List files and directories in the workspace.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "glob",
        label: "Glob",
        description: "Find workspace paths with glob patterns.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "grep",
        label: "Grep",
        description: "Search file contents with regular expressions.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
    ];
  }

  createTools(run: RunContext): Record<string, RuntimeTool> {
    const fsProvider = new SafeFsProvider(run.workspacePath);
    return {
      announce: announceTool,
      readFile: createReadFileTool(fsProvider),
      listFiles: createListFilesTool(fsProvider),
      glob: createGlobTool(fsProvider),
      grep: createGrepTool(fsProvider),
    };
  }
}
