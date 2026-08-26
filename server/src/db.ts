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
}
