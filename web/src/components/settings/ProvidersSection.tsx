import { useCallback, useEffect, useState } from "react";
import { Boxes, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  deleteProvider,
  listProviders,
  listProviderTypes,
  updateProvider,
  type ProviderInfo,
  type ProviderTypeInfo,
} from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";
import { ModelsSheet } from "./ModelsSheet";
import { ProviderFormSheet } from "./ProviderFormSheet";

interface ProvidersSectionProps {
  onChanged?: () => void;
}

export function ProvidersSection({ onChanged }: ProvidersSectionProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [types, setTypes] = useState<ProviderTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<ProviderInfo | null>(null);
  const [modelsProvider, setModelsProvider] = useState<ProviderInfo | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [providerList, typeList] = await Promise.all([listProviders(), listProviderTypes()]);
      setProviders(providerList);
      setTypes(typeList);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载供应商失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleChanged() {
    await refresh();
    onChanged?.();
  }

  async function toggleActive(provider: ProviderInfo, isActive: boolean) {
    setProviders((current) => current.map((entry) => (entry.id === provider.id ? { ...entry, isActive } : entry)));
    try {
      await updateProvider(provider.id, { isActive });
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败");
    }
  }

  async function removeProvider() {
    if (!deleteInfo) return;
    const target = deleteInfo;
    setDeleteInfo(null);
    try {
      await deleteProvider(target.id);
      await handleChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  const renderList = () => {
    if (loading) {
      return (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> 加载中...
        </p>
      );
    }
    if (providers.length === 0) {
      return (
        <p className="p-8 text-center text-sm text-muted-foreground">
          还没有供应商，点击「添加」创建自定义提供商。
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2 p-4">
        {providers.map((provider) => (
          <Item variant="outline" key={provider.id}>
            <ItemContent>
              <ItemTitle>
                <div className="flex flex-row items-center gap-2">
                  <ProviderIcon type={provider.type} size={32} className="rounded-sm" />
                  <div className="flex flex-col">
                    {provider.name}
                    <small className="text-xs font-normal text-muted-foreground">
                      {provider.type} · {provider.apiBase}
                      {provider.apiKeyMasked ? ` · ${provider.apiKeyMasked}` : ""}
                    </small>
                  </div>
                </div>
              </ItemTitle>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={provider.isActive}
                onCheckedChange={(checked) => void toggleActive(provider, !!checked)}
              />
              <Button variant="outline" size="sm" onClick={() => setModelsProvider(provider)}>
                <Boxes size={14} />
                模型
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  setFormInitial(provider);
                  setFormOpen(true);
                }}
                title="编辑"
              >
                <Pencil size={14} />
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={() => setDeleteInfo({ id: provider.id, name: provider.name })}
                title="删除"
              >
                <Trash2 size={14} />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="text-base font-semibold">模型供应商</div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setFormInitial(null);
              setFormOpen(true);
            }}
          >
            <Plus size={14} />
            添加
          </Button>
        </div>
      </div>

      {error && <p className="px-4 text-xs text-destructive">{error}</p>}

      <ScrollArea className="min-h-0 flex-1">{renderList()}</ScrollArea>

      <ProviderFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={formInitial}
        types={types}
        onSaved={() => void handleChanged()}
      />
      <ModelsSheet
        open={modelsProvider !== null}
        onOpenChange={(open) => {
          if (!open) setModelsProvider(null);
        }}
        provider={modelsProvider}
        onSaved={() => void handleChanged()}
      />

      <AlertDialog open={deleteInfo !== null} onOpenChange={(open) => !open && setDeleteInfo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除供应商「{deleteInfo?.name ?? ""}」？该操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void removeProvider()}
            >
              <Trash2 size={14} /> 删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
