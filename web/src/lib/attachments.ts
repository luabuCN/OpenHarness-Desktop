import type { FileUIPart } from "ai";

/**
 * 附件发送前的客户端预处理。
 *
 * 图片：超过尺寸/体积阈值时用 canvas 等比缩放并转 JPEG，控制请求体与
 * 后续每轮重放的上下文体积。
 *
 * 其余附件（PDF、Word、表格等）原样透传：服务端会把它们落盘到工作区
 * `attachments/` 并把路径告诉模型，由 agent 用 readFile 等工具读取——
 * 文本提取在服务端统一做，前端不再内联文件内容（避免回显大段文本）。
 */

/** 图片最长边上限（与主流多模态 API 的推荐输入一致）。 */
const IMAGE_MAX_DIMENSION = 1568;
/** 图片 data URL 超过该长度即触发压缩（约 500KB 二进制）。 */
const IMAGE_MAX_DATA_URL_LENGTH = 700_000;
const IMAGE_JPEG_QUALITY = 0.85;

export async function prepareAttachments(
  files: FileUIPart[],
): Promise<FileUIPart[]> {
  const prepared = await Promise.all(
    files.map(async (file) => {
      if (!file.mediaType.startsWith("image/")) return file;
      try {
        return await downscaleImage(file);
      } catch {
        return file;
      }
    }),
  );
  return prepared;
}

async function downscaleImage(file: FileUIPart): Promise<FileUIPart> {
  if (!file.url.startsWith("data:")) return file;
  const image = await loadImage(file.url);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longest) return file;

  const needsResize = longest > IMAGE_MAX_DIMENSION;
  const needsCompress = file.url.length > IMAGE_MAX_DATA_URL_LENGTH;
  if (!needsResize && !needsCompress) return file;

  const scale = needsResize ? IMAGE_MAX_DIMENSION / longest : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  // JPEG 没有透明通道，先铺白底，避免 PNG 透明区域压黑。
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
  if (!dataUrl || dataUrl.length >= file.url.length) return file;

  return {
    ...file,
    url: dataUrl,
    mediaType: "image/jpeg",
    filename: withJpegExtension(file.filename),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = url;
  });
}

function withJpegExtension(filename: string | undefined): string | undefined {
  if (!filename) return filename;
  return /\.(png|webp|gif|bmp|avif)$/i.test(filename)
    ? filename.replace(/\.\w+$/, ".jpg")
    : filename;
}
