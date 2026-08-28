import { PanelLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn, isWithinEventTarget } from "@/lib/utils";

/**
 * 侧边栏开关：点击展开/收起。悬停预览由左边缘热区 SidebarPeekZone 触发。
 */
export function SidebarPeekTrigger({ className }: { className?: string }) {
  const { isMobile, open, setOpen, openMobile, setOpenMobile, setPreviewOpen } =
    useSidebar();

  return (
    <Button
      data-slot="sidebar-peek-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0", className)}
      title={open ? "收起侧边栏" : "展开侧边栏"}
      aria-label={open ? "收起侧边栏" : "展开侧边栏"}
      onClick={() => {
        if (isMobile) setOpenMobile(!openMobile);
        else setOpen(!open);
        setPreviewOpen(false);
      }}
    >
      <PanelLeftIcon className="size-4" />
    </Button>
  );
}

/**
 * 左边缘热区：侧边栏折叠时，鼠标贴到窗口最左侧即以浮层形式弹出侧边栏；
 * 移出浮层（或热区）后自动收回。
 * `z-20` 必须高于侧栏容器的 `z-10`，否则会被容器内部贴边的 SidebarRail
 * 拦截鼠标事件（rail 在容器层叠上下文内整体绘制在低层级热区之上）。
 */
export function SidebarPeekZone() {
  const { isMobile, open, setOpen, setPreviewOpen } = useSidebar();

  if (isMobile || open) return null;

  return (
    <div
      data-slot="sidebar-peek-zone"
      aria-hidden="true"
      className="fixed inset-y-0 left-0 z-20 w-2"
      onMouseEnter={() => setPreviewOpen(true)}
      onMouseLeave={(event) => {
        if (
          isWithinEventTarget(event.relatedTarget, '[data-slot="sidebar-container"]')
        ) {
          return;
        }
        setPreviewOpen(false);
      }}
      onClick={() => {
        // 接管原 rail 贴边点击展开的能力：点击左边缘直接固定展开。
        setOpen(true);
        setPreviewOpen(false);
      }}
    />
  );
}
