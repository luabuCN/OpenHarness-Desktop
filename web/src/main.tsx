import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { App } from "./App";
import { initAppearance } from "@/lib/appearance";
import { initLanguage } from "@/lib/i18n";
import "./styles.css";

// 渲染前应用已保存的主题/字体/语言，配合 index.html 的预加载脚本避免闪烁。
initAppearance();
initLanguage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
