import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

/** 模块加载时判定一次：浏览器里直接访问 dev server 时没有窗口可控制。 */
const inTauri = isTauri();

export function isTauriWindow() {
  return inTauri;
}

/**
 * 顶栏为右上角窗口按钮（3 × 46px + 与内容的间距）预留的右侧内边距。
 * 非窗口环境（浏览器）不加，按钮也不渲染，两侧保持一致。
 */
export const windowControlsReserveClass = "pr-[146px]";

/**
 * 无边框窗口的自绘控制按钮：最小化 / 最大化还原 / 关闭，固定在窗口
 * 右上角，浮在聊天、设置、右侧面板的顶栏之上。关闭按钮悬停使用
 * Windows 标准红；点击关闭走窗口 CloseRequested 事件，仍受
 * 「关闭到托盘」设置约束。
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    const current = getCurrentWindow();
    let disposed = false;
    const sync = () => {
      void current
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => undefined);
    };
    sync();
    const unlisten = current.onResized(sync);
    return () => {
      disposed = true;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  if (!inTauri) return null;

  return (
    <div className="fixed top-0 right-0 z-[60] flex h-9">
      <button
        type="button"
        className="flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="最小化"
        aria-label="最小化"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? (
          <Copy className="size-3" />
        ) : (
          <Square className="size-3" />
        )}
      </button>
      <button
        type="button"
        className="flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-[#e81123] hover:text-white"
        title="关闭"
        aria-label="关闭"
        onClick={() => void getCurrentWindow().close()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
