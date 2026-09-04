import type { SkillInfo, SkillSource } from "@/api";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<SkillSource, string> = {
  custom: "自定义",
  claude: "Claude",
  codex: "Codex",
  ccswitch: "cc-switch",
};

interface SlashSkillMenuProps {
  items: SkillInfo[];
  highlight: number;
  onHighlightChange: (index: number) => void;
  onAccept: (skill: SkillInfo) => void;
}

/** 输入框上方的「/技能」选择列表。键盘导航由输入框的 onKeyDown 驱动，
 * 这里只负责展示与鼠标选择（onMouseDown 阻止默认，避免输入框失焦）。 */
export function SlashSkillMenu({ items, highlight, onHighlightChange, onAccept }: SlashSkillMenuProps) {
  return (
    <div
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
      role="listbox"
      aria-label="技能列表"
    >
      <div className="max-h-72 overflow-y-auto p-1">
        {items.map((skill, index) => (
          <button
            key={skill.key}
            type="button"
            role="option"
            aria-selected={index === highlight}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHighlightChange(index)}
            onClick={() => onAccept(skill)}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
              index === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span className="font-mono text-sm">/{skill.id}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{skill.name}</span>
              <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {SOURCE_LABEL[skill.source]}
              </span>
            </span>
            {skill.description ? (
              <span className="line-clamp-1 w-full text-xs text-muted-foreground">
                {skill.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        ↑↓ 选择 · Tab / Enter 确认 · Esc 关闭；发送时自动应用所选技能
      </div>
    </div>
  );
}
