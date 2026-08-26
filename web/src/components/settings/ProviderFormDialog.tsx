import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Loader2, Search } from "lucide-react";

import {
  createProvider,
  fetchRemoteModels,
  updateProvider,
  type ProviderInfo,
  type ProviderModel,
  type ProviderTypeInfo,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";

interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProviderInfo | null;
  types: ProviderTypeInfo[];
  onSaved: () => void;
}

function mergeModels(fetched: ProviderModel[], existing: ProviderModel[]): ProviderModel[] {
  const enabledById = new Map(existing.map((model) => [model.id, model.enabled]));
  const known = new Set(fetched.map((model) => model.id));
  const manual = existing.filter((model) => !known.has(model.id));
  return [
    ...fetched.map((model) => ({ ...model, enabled: enabledById.get(model.id) ?? true })),
    ...manual,
  ];
}

export function ProviderFormDialog({ open, onOpenChange, initial, types, onSaved }: ProviderFormDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeSearch, setTypeSearch] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setType(initial?.type ?? "");
    setApiBase(initial?.apiBase ?? "");
    setApiKey(initial?.apiKey ?? "");
    setModels(initial?.models ?? []);
    setTypeOpen(false);
    setTypeSearch("");
    setError(undefined);
    setNotice(undefined);
  }, [open, initial]);

  const filteredTypes = useMemo(() => {
    const query = typeSearch.trim().toLowerCase();
    if (!query) return types;
    return types.filter(
      (entry) => entry.id.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query),
    );
  }, [types, typeSearch]);

  const selectedType = types.find((entry) => entry.id === type);

  function selectType(entry: ProviderTypeInfo) {
    const previousDefault = types.find((candidate) => candidate.id === type)?.api;
    setType(entry.id);
    setTypeOpen(false);
    if (!apiBase.trim() || (previousDefault && apiBase.trim() === previousDefault)) {
      setApiBase(entry.api ?? "");
    }
    if (!name.trim() && !initial) setName(entry.name);
  }

  async function pullModels() {
    if (!apiBase.trim()) {
      setError("请先填写 API Base URL");
      return;
    }
    setFetching(true);
    setError(undefined);
    try {
      const fetched = await fetchRemoteModels(apiBase, apiKey || null);
      setModels((current) => mergeModels(fetched, current));
      setNotice(`已从 ${apiBase.trim()} 拉取 ${fetched.length} 个模型`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉取模型失败");
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    if (!name.trim() || !type || !apiBase.trim()) {
      setError("名称、类型与 API Base URL 为必填项");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      let finalModels = models;
      if (finalModels.length === 0) {
        // Best-effort auto pull so a fresh provider arrives with its catalog.
        try {
          finalModels = await fetchRemoteModels(apiBase, apiKey || null);
          setNotice(`已自动拉取 ${finalModels.length} 个模型`);
        } catch {
          finalModels = [];
        }
      }
      const payload = {
        name: name.trim(),
        type,
        apiBase: apiBase.trim(),
        apiKey: apiKey.trim() ? apiKey.trim() : null,
        models: finalModels,
      };
      if (initial) {
        await updateProvider(initial.id, payload);
      } else {
        await createProvider(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "编辑 Provider" : "新建 Provider"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="provider-name">名称</label>
            <Input
              id="provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 OpenAI-US"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">类型</label>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors hover:bg-muted"
              onClick={() => setTypeOpen((value) => !value)}
            >
              {selectedType ? (
                <span className="flex items-center gap-2">
                  <ProviderIcon type={selectedType.id} size={18} />
                  {selectedType.name}
                </span>
              ) : (
                <span className="text-muted-foreground">选择类型</span>
              )}
              <ChevronDown size={16} className={cn("transition-transform", typeOpen && "rotate-180")} />
            </button>
            {typeOpen && (
              <div className="overflow-hidden rounded-md border border-input">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Search size={14} className="text-muted-foreground" />
                  <input
                    className="w-full bg-transparent text-sm outline-none"
                    placeholder="搜索类型"
                    value={typeSearch}
                    onChange={(event) => setTypeSearch(event.target.value)}
                  />
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  {filteredTypes.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">无匹配类型</p>
                  ) : (
                    filteredTypes.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                          entry.id === type && "bg-accent text-accent-foreground",
                        )}
                        onClick={() => selectType(entry)}
                      >
                        <ProviderIcon type={entry.id} size={18} />
                        <span className="truncate">{entry.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="provider-api-base">API Base URL</label>
            <Input
              id="provider-api-base"
              value={apiBase}
              onChange={(event) => setApiBase(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="provider-api-key">API Key</label>
            <Input
              id="provider-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void pullModels()} disabled={fetching}>
              {fetching ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              拉取模型
            </Button>
            <span className="text-xs text-muted-foreground">{models.length} 个模型</span>
          </div>

          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
