import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderCode, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import {
  deleteSkill,
  listSkills,
  updateSkill,
  type SkillInfo,
  type SkillSourceInfo,
  type SkillSource,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { SkillFormSheet } from "./SkillFormSheet";

/** 技能管理：默认扫描 Claude / Codex / cc-switch 的本地技能目录，外加可在
 * 应用内增删改的自定义技能；只有启用的技能会进入模型上下文。 */
export function SkillsSection() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sources, setSources] = useState<SkillSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SkillInfo | null>(null);
  const [deleting, setDeleting] = useState<SkillInfo | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSkills();
      setSkills(data.skills);
      setSources(data.sources);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载技能失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const order: SkillSource[] = ["custom", "claude", "codex", "ccswitch"];
    return order
      .map((source) => ({
        source,
        meta: sources.find((item) => item.source === source),
        items: skills
          .filter((skill) => skill.source === source)
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .filter((group) => group.items.length > 0 || group.source === "custom");
  }, [skills, sources]);

  async function toggleEnabled(entry: SkillInfo, enabled: boolean) {
    setSkills((current) =>
      current.map((item) => (item.key === entry.key ? { ...item, enabled } : item)),
    );
    try {
      await updateSkill(entry.key, { enabled });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败");
      void refresh();
    }
  }

  async function remove() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await deleteSkill(target.key);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <div>
          <div className="text-base font-semibold">技能</div>
          <p className="text-xs text-muted-foreground">
            本地 Claude / Codex / cc-switch 技能目录自动同步；输入框里输入「/」可用技能名显式调用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void refresh()} title="重新扫描技能目录">
            <RefreshCw size={14} />
            刷新
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={14} />
            创建
          </Button>
        </div>
      </div>
      {error ? <p className="px-4 text-xs text-destructive">{error}</p> : null}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            加载中...
          </p>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {grouped.map((group) => (
              <div key={group.source} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {group.source === "custom" ? <Sparkles size={14} /> : <FolderCode size={14} />}
                    {group.meta?.label ?? group.source}
                    <span className="text-xs font-normal text-muted-foreground">
                      {group.items.length} 个
                    </span>
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted-foreground" title={group.meta?.dir}>
                    {group.meta?.dir}
                  </span>
                </div>
                {group.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                    暂无技能，点击右上角「创建」添加。
                  </div>
                ) : (
                  group.items.map((entry) => (
                    <Item variant="outline" key={entry.key}>
                      <ItemContent>
                        <ItemTitle>
                          <span className="font-mono">/{entry.id}</span>
                          <span className="font-normal text-muted-foreground">{entry.name}</span>
                          {!entry.enabled ? <Badge variant="outline">停用</Badge> : null}
                          {entry.source !== "custom" ? (
                            <Badge variant="secondary">{group.meta?.label ?? entry.source}</Badge>
                          ) : null}
                        </ItemTitle>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {entry.description ?? "（无描述）"}
                        </p>
                      </ItemContent>
                      <ItemActions>
                        <Switch
                          checked={entry.enabled}
                          onCheckedChange={(checked) => void toggleEnabled(entry, !!checked)}
                        />
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title={entry.isCustom ? "编辑" : "外部技能请直接修改源文件"}
                          disabled={!entry.isCustom}
                          onClick={() => {
                            setEditing(entry);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          title={entry.isCustom ? "删除" : "外部来源技能不能在应用内删除"}
                          disabled={!entry.isCustom}
                          onClick={() => setDeleting(entry)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </ItemActions>
                    </Item>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <SkillFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSaved={() => void refresh()}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除技能「{deleting?.name ?? ""}」？将移除对应的技能目录，操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              <Trash2 size={14} />
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
