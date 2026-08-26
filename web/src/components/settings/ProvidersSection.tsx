import { useCallback, useEffect, useState } from "react";
import { Boxes, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  deleteProvider,
  getDefaultModel,
  listProviders,
  listProviderTypes,
  setDefaultModel,
  updateProvider,
  type DefaultModelSetting,
  type ProviderInfo,
  type ProviderTypeInfo,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";
import { ModelsDialog } from "./ModelsDialog";
import { ProviderFormDialog } from "./ProviderFormDialog";

interface ProvidersSectionProps {
  onChanged?: () => void;
}

export function ProvidersSection({ onChanged }: ProvidersSectionProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [types, setTypes] = useState<ProviderTypeInfo[]>([]);
  const [defaultModel, setDefaultModelState] = useState<DefaultModelSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<ProviderInfo | null>(null);
  const [modelsProvider, setModelsProvider] = useState<ProviderInfo | null>(null);

  const [defaultProviderId, setDefaultProviderId] = useState("");
  const [defaultModelId, setDefaultModelId] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [providerList, typeList, setting] = await Promise.all([
        listProviders(),
        listProviderTypes(),
        getDefaultModel(),
      ]);
      setProviders(providerList);
      setTypes(typeList);
      setDefaultModelState(setting);
      setError(undefined);
      if (setting) {
        setDefaultProviderId(setting.providerId);
        setDefaultModelId(setting.modelId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载供应商失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeProviders = providers.filter((provider) => provider.isActive);
  const defaultProvider = providers.find((provider) => provider.id === defaultProviderId);
  const defaultModelOptions = (defaultProvider?.models ?? []).filter((model) => model.enabled);

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

  async function handleDelete(provider: ProviderInfo) {
    if (!window.confirm(`删除供应商「${provider.name}」？`)) return;
    try {
      await deleteProvider(provider.id);
      await handleChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  async function saveDefaultModel() {
    if (!defaultProviderId || !defaultModelId) return;
    setSavingDefault(true);
    try {
      await setDefaultModel({ providerId: defaultProviderId, modelId: defaultModelId });
      await handleChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存默认模型失败");
    } finally {
      setSavingDefault(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">模型供应商</h2>
        <Button
          size="sm"
          onClick={() => {
            setFormInitial(null);
            setFormOpen(true);
          }}
        >
          <Plus size={14} />
          添加
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">默认模型</p>
        <p className="text-xs text-muted-foreground">
          选择运行时使用的供应商与模型；未设置时回退到 .env 中的网关配置。
        </p>
        <div className="flex items-center gap-2">
          <select
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
            value={defaultProviderId}
            onChange={(event) => {
              setDefaultProviderId(event.target.value);
              setDefaultModelId("");
            }}
          >
            <option value="">选择供应商</option>
            {activeProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
          <select
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
            value={defaultModelId}
            onChange={(event) => setDefaultModelId(event.target.value)}
            disabled={!defaultProvider}
          >
            <option value="">选择模型</option>
            {defaultModelOptions.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!defaultProviderId || !defaultModelId || savingDefault}
            onClick={() => void saveDefaultModel()}
          >
            {savingDefault ? <Loader2 size={14} className="animate-spin" /> : null}
            保存
          </Button>
          {defaultModel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void setDefaultModel(null).then(() => handleChanged());
              }}
              title="清除默认模型，回退到环境变量"
            >
              清除
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> 加载中...
        </p>
      ) : providers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          还没有供应商，点击「添加」创建自定义提供商。
        </p>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <div key={provider.id} className="flex items-center gap-3 rounded-lg border p-3">
              <ProviderIcon type={provider.type} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{provider.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {provider.type} · {provider.apiBase}
                </p>
              </div>
              <Switch checked={provider.isActive} onCheckedChange={(checked) => void toggleActive(provider, checked)} />
              <Button variant="outline" size="sm" onClick={() => setModelsProvider(provider)}>
                <Boxes size={14} />
                模型
                <span className="text-xs text-muted-foreground">{provider.models.length}</span>
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
              <Button variant="destructive" size="icon-sm" onClick={() => void handleDelete(provider)} title="删除">
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ProviderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={formInitial}
        types={types}
        onSaved={() => void handleChanged()}
      />
      <ModelsDialog
        open={modelsProvider !== null}
        onOpenChange={(open) => {
          if (!open) setModelsProvider(null);
        }}
        provider={modelsProvider}
        onSaved={() => void handleChanged()}
      />
    </div>
  );
}
