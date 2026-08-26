import { Hono } from "hono";
import { fsProvider } from "../runtime/tools.js";

export const fileRoutes = new Hono();

fileRoutes.get("/", async (c) => {
  const dirPath = c.req.query("path") ?? "";
  try {
    const entries = await fsProvider.readdir(dirPath);
    return c.json({
      path: dirPath,
      entries: entries
        .map((entry) => ({
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
        }))
        .sort(
          (a, b) =>
            Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
        ),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Cannot list directory" },
      400,
    );
  }
});
