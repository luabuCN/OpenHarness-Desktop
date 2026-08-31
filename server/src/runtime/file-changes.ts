import path from "node:path";
import { structuredPatch } from "diff";
import { prisma } from "../db.js";
import { formatBytes } from "./tools/fs-utils.js";

export type FileChangeKind = "create" | "edit" | "delete";

/** Compact per-edit summary returned from edit tools and stored on FileChange rows. */
export interface FileEditSummary {
  /** Workspace-relative path with forward slashes. */
  path: string;
  changeKind: FileChangeKind;
  /** Unified diff; null when the file is binary or contents were unavailable. */
  unifiedDiff: string | null;
  additions: number;
  deletions: number;
  /** True when the unified diff was cut to MAX_DIFF_OUTPUT_LINES for display. */
  truncated: boolean;
}

/** before/after snapshots persisted for one-click revert; oversized files keep no snapshot. */
export const MAX_SNAPSHOT_BYTES = 512 * 1_024;
/** Diff lines included in tool outputs and API responses; the DB stores the same trimmed diff. */
export const MAX_DIFF_OUTPUT_LINES = 400;

function clampSnapshot(content: string | null): string | null {
  if (content === null) return null;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes <= MAX_SNAPSHOT_BYTES) return content;
  return `${content.slice(0, MAX_SNAPSHOT_BYTES)}\n... (snapshot truncated at ${formatBytes(MAX_SNAPSHOT_BYTES)})`;
}

/**
 * Compute a unified diff plus add/delete counts from before/after contents.
 * Creations diff against an empty base so the whole file shows as added
 * lines; both contents null (binary or unavailable) yields a null diff.
 */
export function computeFileDiff(input: {
  relativePath: string;
  before: string | null;
  after: string | null;
  changeKind?: FileChangeKind;
}): FileEditSummary {
  const { relativePath } = input;
  const changeKind: FileChangeKind =
    input.changeKind ??
    (input.before === null ? "create" : input.after === null ? "delete" : "edit");
  if (input.before === null && input.after === null) {
    return { path: relativePath, changeKind, unifiedDiff: null, additions: 0, deletions: 0, truncated: false };
  }

  const patch = structuredPatch(`a/${relativePath}`, `b/${relativePath}`, input.before ?? "", input.after ?? "", "", "", {
    context: 3,
  });

  const bodyLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    bodyLines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
      bodyLines.push(line);
    }
  }

  const truncated = bodyLines.length > MAX_DIFF_OUTPUT_LINES;
  const shown = truncated ? bodyLines.slice(0, MAX_DIFF_OUTPUT_LINES) : bodyLines;
  const unifiedDiff =
    `--- a/${relativePath}\n+++ b/${relativePath}\n` +
    shown.join("\n") +
    (truncated ? `\n\\ diff truncated after ${MAX_DIFF_OUTPUT_LINES} lines (${bodyLines.length} total)` : "");

  return { path: relativePath, changeKind, unifiedDiff, additions, deletions, truncated };
}

export interface RecordFileChangeInput {
  runId?: string;
  conversationId: string;
  projectId?: string;
  workspacePath: string;
  absolutePath: string;
  before: string | null;
  after: string | null;
  /** Whether the file existed before this edit; only genuine creations pass false. */
  existed: boolean;
}

/**
 * Persist one workspace edit as a FileChange row and return the summary that
 * tool outputs and the changes panel render. Bookkeeping failures are logged
 * but never fail the edit itself.
 */
export async function recordFileChange(input: RecordFileChangeInput): Promise<FileEditSummary> {
  const relativePath = path.relative(input.workspacePath, input.absolutePath).replaceAll("\\", "/");
  const changeKind: FileChangeKind = input.existed ? "edit" : "create";
  const summary = computeFileDiff({
    relativePath,
    before: input.before,
    after: input.after,
    changeKind,
  });

  await prisma.fileChange
    .create({
      data: {
        runId: input.runId ?? null,
        conversationId: input.conversationId,
        projectId: input.projectId ?? null,
        path: relativePath,
        changeKind: summary.changeKind,
        before: clampSnapshot(input.before),
        after: clampSnapshot(input.after),
        unifiedDiff: summary.unifiedDiff,
        additions: summary.additions,
        deletions: summary.deletions,
      },
    })
    .catch((error) => console.error("[file-changes] persist failed:", error));

  return summary;
}
