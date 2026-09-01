import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import type { ChatUIMessage } from "@/lib/chat-utils";
import {
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
  type ConversationMinimapMarker,
} from "@/lib/conversation-minimap";

/* 对话大纲（参考 PI-Desktop 的 ConversationMinimap）：对话区左缘一列
 * 短横线，每条对应一次用户提问（长线）或助手回复（短线）。光标沿轨道
 * 移动时按 macOS Dock 的余弦衰减放大附近横线，最近的横线弹出消息预览
 * 气泡，点击跳转到该消息。横线只沿水平方向放大，放大不会重排轨道。 */

/* Dock 放大：衰减半径（px）与峰值放大量。 */
const MAGNIFY_RADIUS = 46;
const MAGNIFY_BOOST = 1.3;
/* 光标距横线中心不超过该值时，预览气泡吸附到该横线。 */
const POPOVER_SNAP = 24;
const POPOVER_HEIGHT = 132;
/* 滚动余量超过该值才算“内容超出一屏”。 */
const OVERFLOW_EPSILON_PX = 1;

const ROLE_LABELS: Record<ConversationMinimapMarker["role"], string> = {
  user: "用户消息",
  assistant: "助手消息",
};

export const ConversationMinimap = memo(function ConversationMinimap({
  messages,
}: {
  messages: ChatUIMessage[];
}) {
  const { scrollRef, contentRef } = useStickToBottomContext();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{
    marker: ConversationMinimapMarker;
    top: number;
  } | null>(null);
  const [overflows, setOverflows] = useState(false);
  const railRef = useRef<HTMLElement>(null);
  const markerEls = useRef(new Map<string, HTMLButtonElement>());
  const moveRaf = useRef(0);

  /* 缓存各锚点的滚动偏移，滚动帧上只做二分查找，不重复查 DOM。 */
  const cachedOffsetsRef = useRef<{ id: string; offset: number }[]>([]);
  /* 值未变化时跳过 setState，避免无谓的重渲染。 */
  const activeIdRef = useRef<string | null>(null);
  const overflowsRef = useRef(false);

  const markers = useMemo(
    () => buildConversationMinimapMarkers(messages),
    [messages],
  );
  const markerIdentity = useMemo(
    () => markers.map((marker) => marker.id).join("\u0000"),
    [markers],
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;

  /* 从 DOM 重新测量锚点偏移；仅在标记集合变化或尺寸变化时调用。 */
  const recomputeOffsets = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      cachedOffsetsRef.current = [];
      return;
    }
    const baseTop = el.getBoundingClientRect().top;
    const markerIds = new Set(markersRef.current.map((marker) => marker.id));
    const out: { id: string; offset: number }[] = [];
    el.querySelectorAll<HTMLElement>("[data-minimap-id]").forEach((node) => {
      const id = node.dataset.minimapId || "";
      if (!markerIds.has(id)) return;
      out.push({
        id,
        offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
      });
    });
    cachedOffsetsRef.current = out;
  }, [scrollRef]);

  /**
   * 各横线的竖直中心（轨道内局部坐标）。
   *
   * 横线高度固定、只沿水平方向放大，所以中心只随轨道布局变化，与光标
   * 无关。每次布局后测量一次，让 hover 不在关键路径上：applyMagnify 在
   * 每帧 mousemove 里执行，若在那里读 offsetTop（与同一循环里写入的
   * --magnify 交错）会迫使每条横线各触发一次同步重排。
   */
  const magnifyCentersRef = useRef<{ id: string; center: number }[]>([]);

  const measureMagnifyCenters = useCallback(() => {
    const centers: { id: string; center: number }[] = [];
    // 只读遍历：不写样式，布局至多计算一次。
    for (const [id, btn] of markerEls.current) {
      centers.push({ id, center: btn.offsetTop + btn.offsetHeight / 2 });
    }
    centers.sort((a, b) => a.center - b.center);
    magnifyCentersRef.current = centers;
  }, []);

  /* jumpTo 专用的新鲜测量（需要像素级准确）。 */
  const getOffsets = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return [];
    const baseTop = el.getBoundingClientRect().top;
    const markerIds = new Set(markersRef.current.map((marker) => marker.id));
    const out: { id: string; offset: number }[] = [];
    el.querySelectorAll<HTMLElement>("[data-minimap-id]").forEach((node) => {
      const id = node.dataset.minimapId || "";
      if (!markerIds.has(id)) return;
      out.push({
        id,
        offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
      });
    });
    return out;
  }, [scrollRef]);

  /* 用缓存偏移 + 二分查找做 O(log n) 的当前区段追踪。 */
  const updateActive = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const offsets = cachedOffsetsRef.current;
    if (offsets.length === 0) {
      if (activeIdRef.current !== null) {
        activeIdRef.current = null;
        setActiveId(null);
      }
      return;
    }
    const anchor = el.scrollTop + el.clientHeight * 0.3;
    // 二分找最后一个 offset <= anchor 的锚点。
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (offsets[mid].offset <= anchor) lo = mid;
      else hi = mid - 1;
    }
    const id = offsets[lo].id;
    if (id !== activeIdRef.current) {
      activeIdRef.current = id;
      setActiveId(id);
    }
  }, [scrollRef]);

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      if (overflowsRef.current) {
        overflowsRef.current = false;
        setOverflows(false);
      }
      return;
    }
    // 一屏内容没有滚动范围，轨道只在溢出时才有用。
    const nowOverflows = el.scrollHeight - el.clientHeight > OVERFLOW_EPSILON_PX;
    if (nowOverflows !== overflowsRef.current) {
      overflowsRef.current = nowOverflows;
      setOverflows(nowOverflows);
    }
  }, [scrollRef]);

  useEffect(() => {
    recomputeOffsets();
    updateOverflow();
    measureMagnifyCenters();
  }, [markerIdentity, measureMagnifyCenters, recomputeOffsets, updateOverflow]);

  useEffect(() => {
    updateActive();
  }, [markerIdentity, updateActive]);

  /* 横线中心跟随轨道自身的盒子：轨道高度由会话区高度决定，不受标记集合
     或窗口变化单独驱动，观察轨道本身能覆盖所有成因。 */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureMagnifyCenters);
    });
    observer.observe(rail);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // overflows 决定轨道是否挂载，轨道重新出现时要重挂观察器。
  }, [measureMagnifyCenters, overflows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let scrollRaf = 0;
    let resizeRaf = 0;
    const scheduleScroll = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        updateActive();
        updateOverflow();
      });
    };
    const scheduleResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        recomputeOffsets();
        updateActive();
        updateOverflow();
        measureMagnifyCenters();
      });
    };
    recomputeOffsets();
    el.addEventListener("scroll", scheduleScroll, { passive: true });
    // 流式输出在标记集合不变时也会持续改变布局，观察内容容器。
    const content = contentRef.current;
    const ro =
      content && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleResize)
        : null;
    if (ro && content) ro.observe(content);
    window.addEventListener("resize", scheduleResize);
    return () => {
      el.removeEventListener("scroll", scheduleScroll);
      ro?.disconnect();
      cancelAnimationFrame(scrollRaf);
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize", scheduleResize);
    };
  }, [contentRef, measureMagnifyCenters, scrollRef, updateActive, updateOverflow, recomputeOffsets]);

  const jumpTo = useCallback(
    (id: string) => {
      const el = scrollRef.current;
      if (!el) return;
      const target = getOffsets().find((entry) => entry.id === id);
      if (!target) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const top = Math.max(0, target.offset - 24);
      if (reduceMotion) {
        el.scrollTo({ top, behavior: "auto" });
        return;
      }
      // 消息启用了 content-visibility，屏幕外高度是估算值：先瞬时跳转
      // 让浏览器完成真实布局，再按修正后的位置平滑滚动，长会话不漂移。
      el.scrollTo({ top, behavior: "auto" });
      requestAnimationFrame(() => {
        const corrected = getOffsets().find((entry) => entry.id === id);
        el.scrollTo({
          top: Math.max(0, (corrected ?? target).offset - 24),
          behavior: "smooth",
        });
      });
    },
    [scrollRef, getOffsets],
  );

  /* Dock 放大以命令式方式应用，mousemove 永远不触发重渲染。横线按钮高度
   * 固定，缩放不影响布局。中心来自缓存测量：在同一循环里边读 offsetTop
   * 边写 --magnify 会让每次 hover 帧都按横线数量触发重排。 */
  const applyMagnify = useCallback(
    (cursorY: number | null) => {
      if (magnifyCentersRef.current.length === 0) {
        // 尚未测量（挂载后第一帧）：补一次测量而不是跳过效果。
        measureMagnifyCenters();
      }
      let nearest: { id: string; dist: number; center: number } | null = null;
      for (const { id, center } of magnifyCentersRef.current) {
        const btn = markerEls.current.get(id);
        if (!btn) continue;
        let scale = 1;
        if (cursorY != null) {
          const dist = Math.abs(center - cursorY);
          if (dist < MAGNIFY_RADIUS) {
            scale =
              1 +
              MAGNIFY_BOOST *
                Math.cos((dist / MAGNIFY_RADIUS) * (Math.PI / 2));
          }
          if (dist <= POPOVER_SNAP && (!nearest || dist < nearest.dist)) {
            nearest = { id, dist, center };
          }
        }
        btn.style.setProperty("--magnify", scale.toFixed(3));
      }
      if (nearest) {
        const marker = markersRef.current.find((m) => m.id === nearest!.id);
        const rail = railRef.current;
        if (marker && rail) {
          const top = Math.min(
            Math.max(nearest.center - 36, 0),
            Math.max(rail.clientHeight - POPOVER_HEIGHT, 0),
          );
          setHovered((prev) =>
            prev?.marker.id === marker.id && prev.top === top
              ? prev
              : { marker, top },
          );
          return;
        }
      }
      setHovered(null);
    },
    [measureMagnifyCenters],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const rail = railRef.current;
      if (!rail) return;
      const y = event.clientY - rail.getBoundingClientRect().top;
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = requestAnimationFrame(() => applyMagnify(y));
    },
    [applyMagnify],
  );

  const handleMouseLeave = useCallback(() => {
    cancelAnimationFrame(moveRaf.current);
    applyMagnify(null);
  }, [applyMagnify]);

  useEffect(() => () => cancelAnimationFrame(moveRaf.current), []);

  if (
    !shouldRenderConversationMinimap({
      markerCount: markers.length,
      overflows,
    })
  ) {
    return null;
  }

  return (
    <nav
      className="conversation-minimap-rail"
      ref={railRef}
      aria-label="对话大纲"
      style={
        {
          "--minimap-marker-count": markers.length,
        } as CSSProperties
      }
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          ref={(node) => {
            if (node) markerEls.current.set(marker.id, node);
            else markerEls.current.delete(marker.id);
          }}
          className={`conversation-minimap-marker ${marker.role} ${
            marker.id === activeId ? "active" : ""
          }`}
          aria-label={ROLE_LABELS[marker.role]}
          aria-current={marker.id === activeId ? "true" : undefined}
          onFocus={(event) =>
            setHovered({
              marker,
              top: Math.max(0, event.currentTarget.offsetTop - 36),
            })
          }
          onBlur={() => setHovered(null)}
          onClick={() => jumpTo(marker.id)}
        />
      ))}
      {hovered && hovered.marker.preview ? (
        <div
          className="conversation-minimap-popover"
          role="tooltip"
          style={{ top: `${hovered.top}px` }}
        >
          <div className="conversation-minimap-popover-role">
            {ROLE_LABELS[hovered.marker.role]}
          </div>
          <div className="conversation-minimap-popover-text">
            {hovered.marker.preview}
          </div>
        </div>
      ) : null}
    </nav>
  );
});
