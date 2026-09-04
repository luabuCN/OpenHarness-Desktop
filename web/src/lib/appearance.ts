import { invoke, isTauri } from "@tauri-apps/api/core";

export type ThemePreference = "system" | "light" | "dark";
export type CloseBehavior = "tray" | "quit";
export type UiFontKey =
  | "default"
  | "system"
  | "yahei"
  | "dengxian"
  | "simsun"
  | "simhei"
  | "kaiti";

const THEME_KEY = "openharness.theme";
const FONT_KEY = "openharness.uiFont";
const CLOSE_BEHAVIOR_KEY = "openharness.closeBehavior";

/** 界面字体候选：stack 直接写入 --font-sans，覆盖 body 的字体栈。 */
export const UI_FONTS: { key: UiFontKey; labelKey: string; stack: string }[] = [
  {
    key: "default",
    labelKey: "general.font.default",
    stack: '"AlibabaPuHuiTi-3", "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
  },
  {
    key: "system",
    labelKey: "general.font.system",
    stack: 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  { key: "yahei", labelKey: "general.font.yahei", stack: '"Microsoft YaHei", "微软雅黑", sans-serif' },
  { key: "dengxian", labelKey: "general.font.dengxian", stack: 'DengXian, "等线", sans-serif' },
  { key: "simsun", labelKey: "general.font.simsun", stack: 'SimSun, "宋体", serif' },
  { key: "simhei", labelKey: "general.font.simhei", stack: 'SimHei, "黑体", sans-serif' },
  { key: "kaiti", labelKey: "general.font.kaiti", stack: 'KaiTi, "楷体", serif' },
];

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function applyUiFont(key: UiFontKey) {
  const font = UI_FONTS.find((candidate) => candidate.key === key) ?? UI_FONTS[0];
  document.documentElement.style.setProperty("--font-sans", font.stack);
}

export function loadTheme(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function loadUiFont(): UiFontKey {
  const stored = localStorage.getItem(FONT_KEY);
  return UI_FONTS.some((font) => font.key === stored)
    ? (stored as UiFontKey)
    : "default";
}

export function loadCloseBehavior(): CloseBehavior {
  const stored = localStorage.getItem(CLOSE_BEHAVIOR_KEY);
  return stored === "quit" ? "quit" : "tray";
}

export function setTheme(preference: ThemePreference) {
  localStorage.setItem(THEME_KEY, preference);
  applyTheme(preference);
}

export function setUiFont(key: UiFontKey) {
  localStorage.setItem(FONT_KEY, key);
  applyUiFont(key);
}

export function setCloseBehavior(behavior: CloseBehavior) {
  localStorage.setItem(CLOSE_BEHAVIOR_KEY, behavior);
  // 关闭窗口的拦截发生在 Tauri 主进程，需要把偏好同步过去；浏览器开发
  // 模式下没有主进程，只留存偏好。
  if (isTauri()) {
    void invoke("set_close_behavior", { behavior }).catch(() => undefined);
  }
}

/**
 * 启动时应用已保存的外观偏好，并注册系统深浅色变化监听（仅"跟随系统"
 * 生效）。模块级标记保证 StrictMode 双调用不会重复注册监听。
 */
let initialized = false;
export function initAppearance() {
  if (initialized) return;
  initialized = true;
  applyTheme(loadTheme());
  applyUiFont(loadUiFont());
  setCloseBehavior(loadCloseBehavior());
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (loadTheme() === "system") applyTheme("system");
    });
}
