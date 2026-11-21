import type { SessionListResponse, SessionMessagesResponse } from "../../shared/api-contract";

const MESSAGE_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;

export class SessionMessageCache {
  #entries = new Map<string, { page: SessionMessagesResponse; bytes: number }>();
  #itemBytes = new WeakMap<SessionMessagesResponse["items"][number], number>();
  #totalBytes = 0;

  constructor(private readonly budgetBytes = MESSAGE_CACHE_BUDGET_BYTES) {}

  read(key: string, markAccessed: boolean) {
    const entry = this.#entries.get(key);
    if (entry && markAccessed) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    return entry?.page ?? null;
  }

  store(key: string, page: SessionMessagesResponse | null) {
    if (!page) {
      this.#remove(key);
      return;
    }

    const { items, ...metadata } = page;
    // Estimate two bytes per serialized character. Reuse item sizes across polls and pages.
    let bytes = JSON.stringify(metadata).length * 2;
    for (const item of items) {
      let itemBytes = this.#itemBytes.get(item);
      if (itemBytes === undefined) {
        itemBytes = (JSON.stringify(item).length + 1) * 2;
        this.#itemBytes.set(item, itemBytes);
      }
      bytes += itemBytes;
      if (bytes > this.budgetBytes) break;
    }
    if (bytes > this.budgetBytes) {
      this.#remove(key);
      return;
    }

    this.#totalBytes += bytes - (this.#entries.get(key)?.bytes ?? 0);
    // Updating an existing Map key preserves its position in access order.
    this.#entries.set(key, { page, bytes });
    for (const oldest of this.#entries.keys()) {
      if (this.#totalBytes <= this.budgetBytes) break;
      this.#remove(oldest);
    }
  }

  #remove(key: string) {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#totalBytes -= entry.bytes;
    this.#entries.delete(key);
  }
}

export class SessionCache {
  list: SessionListResponse | null = null;

  constructor(
    private readonly messageCache: SessionMessageCache,
    private readonly node: string | undefined,
  ) {}

  messages(id: string, markAccessed = false) {
    return this.messageCache.read(JSON.stringify([this.node, id]), markAccessed);
  }

  storeMessages(id: string, page: SessionMessagesResponse | null) {
    this.messageCache.store(JSON.stringify([this.node, id]), page);
  }
}
