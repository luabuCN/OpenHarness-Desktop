import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 判断 mouseleave 事件的目标是否落入了指定选择器命中的元素内，
 * 用于在两个相邻浮层元素之间移动时不关闭悬停预览。
 */
export function isWithinEventTarget(
  relatedTarget: EventTarget | null,
  selector: string,
): boolean {
  return (
    relatedTarget instanceof Element &&
    relatedTarget.closest(selector) !== null
  );
}
