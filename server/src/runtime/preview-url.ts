import { config } from "../env.js";

/** 生成内置浏览器面板可加载的文件预览 URL。
 * 路径各段分别编码，保留 / 分隔，这样 HTML 内部的相对资源
 * （./style.css 等）能沿同一前缀正确解析。 */
export function buildPreviewUrl(absolutePath: string): string {
  const normalized = absolutePath.replaceAll("\\", "/");
  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  return `http://${config.host}:${config.port}/preview/${encoded}`;
}
