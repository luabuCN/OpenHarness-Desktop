import { Dialog as DialogPrimitive } from "radix-ui";
import { DownloadIcon, XIcon } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  filename?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 全屏图片预览（参考 PI-Desktop）：点遮罩或 ESC 关闭，图片本体不触发关闭。 */
export function ImageLightbox({ src, filename, open, onOpenChange }: ImageLightboxProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 grid place-items-center p-6 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">
            {filename ?? "图片预览"}
          </DialogPrimitive.Title>
          <figure className="relative" onClick={(event) => event.stopPropagation()}>
            <img
              src={src}
              alt={filename ?? "图片预览"}
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
            />
            <div className="absolute -top-3 right-0 flex translate-y-[-100%] items-center gap-1">
              <a
                href={src}
                download={filename ?? "image"}
                title="保存图片"
                aria-label="保存图片"
                className="flex size-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
              >
                <DownloadIcon className="size-4" />
              </a>
              <button
                type="button"
                aria-label="关闭预览"
                title="关闭预览"
                className="flex size-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                onClick={() => onOpenChange(false)}
              >
                <XIcon className="size-4" />
              </button>
            </div>
            {filename ? (
              <figcaption className="absolute inset-x-0 -bottom-3 translate-y-[100%] truncate text-center text-xs text-white/70">
                {filename}
              </figcaption>
            ) : null}
          </figure>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
