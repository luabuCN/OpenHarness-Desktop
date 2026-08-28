import "./env.js";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function ensureSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL DEFAULT 'New chat',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "StoredMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "sequence" INTEGER NOT NULL,
      "role" TEXT NOT NULL,
      "payload" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "StoredMessage_conversationId_fkey"
        FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "StoredMessage_conversationId_kind_sequence_key" ON "StoredMessage" ("conversationId", "kind", "sequence")',
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "StoredMessage_conversationId_kind_sequence_idx" ON "StoredMessage" ("conversationId", "kind", "sequence")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Provider" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "apiBase" TEXT NOT NULL,
      "apiKey" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "models" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Provider_name_key" ON "Provider" ("name")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppSetting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "rootPath" TEXT NOT NULL,
      "description" TEXT,
      "defaultAgentId" TEXT,
      "defaultModelId" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Project_name_key" ON "Project" ("name")',
  );
  await addColumnIfMissing(`
    ALTER TABLE "Conversation" ADD COLUMN "projectId" TEXT
      REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE
  `);
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Conversation_projectId_idx" ON "Conversation" ("projectId")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadRun" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "projectId" TEXT,
      "agentId" TEXT,
      "thinkingMode" TEXT NOT NULL DEFAULT 'fast',
      "providerId" TEXT,
      "modelId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'queued',
      "error" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "startedAt" DATETIME,
      "completedAt" DATETIME,
      CONSTRAINT "ThreadRun_conversationId_fkey"
        FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ThreadRun_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "ThreadRun_conversationId_status_createdAt_idx" ON "ThreadRun" ("conversationId", "status", "createdAt")',
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "ThreadRun_projectId_createdAt_idx" ON "ThreadRun" ("projectId", "createdAt")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RunEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "runId" TEXT NOT NULL,
      "sequence" INTEGER NOT NULL,
      "eventType" TEXT NOT NULL,
      "payload" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RunEvent_runId_fkey"
        FOREIGN KEY ("runId") REFERENCES "ThreadRun"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "RunEvent_runId_sequence_key" ON "RunEvent" ("runId", "sequence")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ToolApproval" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "runId" TEXT NOT NULL,
      "toolName" TEXT NOT NULL,
      "input" TEXT NOT NULL,
      "reason" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "decisionBy" TEXT,
      "decidedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ToolApproval_runId_fkey"
        FOREIGN KEY ("runId") REFERENCES "ThreadRun"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "ToolApproval_runId_status_idx" ON "ToolApproval" ("runId", "status")',
  );

  const staleStatuses = ["queued", "running", "waiting_approval"];
  await prisma.threadRun.updateMany({
    where: { status: { in: staleStatuses } },
    data: {
      status: "failed",
      error: "Interrupted by sidecar restart",
      completedAt: new Date(),
    },
  });
}

async function addColumnIfMissing(statement: string) {
  try {
    await prisma.$executeRawUnsafe(statement);
  } catch (error) {
    // SQLite reports duplicate columns as raw driver errors rather than a
    // stable Prisma error code, so match on the driver's message.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("duplicate column name")) throw error;
  }
}
