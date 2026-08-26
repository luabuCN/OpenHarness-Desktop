import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import {
  fetchRemoteModels,
  updateProvider,
  type ProviderInfo,
  type ProviderModel,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";

interface ModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderInfo | null;
  onSaved: () => void;
}

export function ModelsDialog({ open, onOpenChange, provider, onSaved }: ModelsDialogProps) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setModels(provider?.models ?? []);
      setSearch("");
      setAdding(false);
      setNewId("");
      setNewName("");
      setError(undefined);
    }
  }, [open, provider]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter(
      (model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query),
    );
  }, [models, search]);

  async function persist(next: ProviderModel[]) {
    if (!provider) return;
    setModels(next);
    setError(undefined);
    try {
      await updateProvider(provider.id, { models: next });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存模型失败");
    }
  }

  function toggle(model: ProviderModel) {
    void persist(models.map((entry) => (entry.id === model.id ? { ...entry, enabled: !entry.enabled } : entry)));
  }

  function remove(model: ProviderModel) {
    void persist(models.filter((entry) => entry.id !== model.id));
  }

  function add() {
    const id = newId.trim();
    if (!id || models.some((entry) => entry.id === id)) return;
    void persist([...models, { id, name: newName.trim() || id, enabled: true }]);
    setNewId("");
    setNewName("");
    setAdding(false);
  }

  async function refresh() {
    if (!provider) return;
    setRefreshing(true);
    setError(undefined);
    try {
      const fetched = await fetchRemoteModels(provider.apiBase, provider.apiKey);
      const enabledById = new Map(models.map((entry) => [entry.id, entry.enabled]));
      const fetchedIds = new Set(fetched.map((entry) => entry.id));
      const manual = models.filter((entry) => !fetchedIds.has(entry.id));
      await persist([
        ...fetched.map((entry) => ({ ...entry, enabled: enabledById.get(entry.id) ?? true })),
        ...manual,
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉取模型失败");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0" showCloseButton>
        <DialogHeader className="border-b p-4">
          <DialogTitle className="flex items-center gap-2">
            {provider && <ProviderIcon type={provider.type} size={20} />}
            模型管理 · {provider?.name ?? ""}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b p-3">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-input px-3 py-1.5">
            <Search size={14} className="text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              placeholder="搜索模型..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="shrink-0 text-xs text-muted-foreground">{filtered.length} 个模型</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus size={14} />
            添加模型
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing} title="从 URL 重新拉取">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>

        {adding && (
          <div className="flex items-center gap-2 border-b bg-muted/40 p-3">
            <Input placeholder="模型 ID" value={newId} onChange={(event) => setNewId(event.target.value)} />
            <Input placeholder="显示名称（可选）" value={newName} onChange={(event) => setNewName(event.target.value)} />
            <Button size="sm" onClick={add} disabled={!newId.trim()}>确定</Button>
          </div>
        )}

        <div className="max-h-[50vh] space-y-2 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              暂无模型，点击右上「刷新」从 {provider?.apiBase} 拉取，或手动添加。
            </p>
          ) : (
            filtered.map((model) => (
              <div key={model.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{model.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{model.id}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch checked={model.enabled} onCheckedChange={() => toggle(model)} />
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(model)} title="移除模型">
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {refreshing && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> 正在从 {provider?.apiBase} 拉取模型...
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
