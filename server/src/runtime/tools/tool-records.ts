import { prisma } from "../../db.js";
import { toolProviderRegistry, type ToolDescriptor } from "./registry.js";

export interface ToolCatalogEntry extends ToolDescriptor {
  /** Current switch state from the tools settings page; descriptors default to active. */
  isActive: boolean;
}

/**
 * Keeps the ToolRecord table in sync with the live provider registry
 * (aime-chat's ToolsManager sync): metadata is refreshed on startup, while
 * isActive/config stay user-owned and are never overwritten.
 */
class ToolRecordService {
  async syncFromRegistry(): Promise<void> {
    for (const descriptor of toolProviderRegistry.descriptors()) {
      await prisma.toolRecord.upsert({
        where: { id: descriptor.name },
        create: {
          id: descriptor.name,
          label: descriptor.label,
          description: descriptor.description,
          risk: descriptor.risk,
          mutating: descriptor.mutating,
          providerId: descriptor.providerId,
          isActive: true,
        },
        update: {
          label: descriptor.label,
          description: descriptor.description,
          risk: descriptor.risk,
          mutating: descriptor.mutating,
          providerId: descriptor.providerId,
        },
      });
    }
  }

  async disabledToolNames(): Promise<Set<string>> {
    const rows = await prisma.toolRecord.findMany({
      where: { isActive: false },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async listCatalog(): Promise<ToolCatalogEntry[]> {
    const records = await prisma.toolRecord.findMany({
      select: { id: true, isActive: true },
    });
    const activeById = new Map(records.map((record) => [record.id, record.isActive]));
    return toolProviderRegistry.descriptors().map((descriptor) => ({
      ...descriptor,
      isActive: activeById.get(descriptor.name) ?? true,
    }));
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    const known = toolProviderRegistry.providerIdOf(id);
    if (!known) throw new Error(`未知工具：${id}`);
    await prisma.toolRecord.upsert({
      where: { id },
      create: {
        id,
        label: id,
        description: "",
        providerId: known,
        isActive,
      },
      update: { isActive },
    });
  }
}

export const toolRecordService = new ToolRecordService();
