/**
 * 会话运行的 chunk 广播中心。
 *
 * 运行的生命周期与 HTTP 连接解耦后（见 agent-runtime），每个进行中的运行
 * 把 UI chunk 顺序写入这里：一方面全量缓冲以支持客户端重连时从头回放
 * （AI SDK 的 resume 协议依赖完整的 start chunk 重建消息并按 messageId
 * 去重），另一方面把新 chunk 推给所有已挂载的订阅者（POST 原始连接之外
 * 通过 GET /api/chat/:conversationId/stream 接入的视图）。
 *
 * 缓冲在运行结束后保留一段宽限期，让"恰好在收尾时切回来"的客户端仍能
 * 拿到完整回放（含 finish chunk），随后整体释放。
 */

type RunChunk = unknown;

interface Subscriber {
  onChunk: (chunk: RunChunk) => void;
  onEnd: () => void;
}

interface RunStreamEntry {
  chunks: RunChunk[];
  done: boolean;
  subscribers: Set<Subscriber>;
  retireTimer?: ReturnType<typeof setTimeout>;
}

/** 运行结束后缓冲的保留时长：晚于此刻接入的客户端走普通快照加载。 */
const RETIRE_GRACE_MS = 8_000;

class RunStreamHub {
  private readonly entries = new Map<string, RunStreamEntry>();

  private entry(runId: string): RunStreamEntry | undefined {
    return this.entries.get(runId);
  }

  open(runId: string) {
    if (this.entries.has(runId)) return;
    this.entries.set(runId, { chunks: [], done: false, subscribers: new Set() });
  }

  /** 泵支路调用：记录并广播一个 chunk。 */
  publish(runId: string, chunk: RunChunk) {
    const entry = this.entry(runId);
    if (!entry) return;
    entry.chunks.push(chunk);
    for (const subscriber of entry.subscribers) {
      try {
        subscriber.onChunk(chunk);
      } catch {
        entry.subscribers.delete(subscriber);
      }
    }
  }

  /** 泵支路读尽后调用：通知订阅者收尾，宽限期后删除整个缓冲。 */
  close(runId: string) {
    const entry = this.entry(runId);
    if (!entry || entry.done) return;
    entry.done = true;
    for (const subscriber of entry.subscribers) {
      try {
        subscriber.onEnd();
      } catch {
        // 订阅者的流已关闭时忽略
      }
    }
    entry.subscribers.clear();
    entry.retireTimer = setTimeout(() => this.entries.delete(runId), RETIRE_GRACE_MS);
    entry.retireTimer.unref?.();
  }

  has(runId: string) {
    return this.entries.has(runId);
  }

  /**
   * 挂载一个订阅者：先同步回放已有缓冲，再接收后续直播 chunk；运行已经
   * 结束时回放后立即触发 onEnd。返回 false 表示运行不存在（或已释放），
   * 调用方应回退到快照加载。
   */
  attach(runId: string, subscriber: Subscriber): boolean {
    const entry = this.entry(runId);
    if (!entry) return false;

    for (const chunk of entry.chunks) subscriber.onChunk(chunk);
    if (entry.done) {
      subscriber.onEnd();
      return true;
    }

    entry.subscribers.add(subscriber);
    return true;
  }

  detach(runId: string, subscriber: Subscriber) {
    this.entry(runId)?.subscribers.delete(subscriber);
  }
}

export const runHub = new RunStreamHub();
