interface ReplayTombstone {
  bytes: number;
  expiresAt: number;
}

/** Bounded LRU replay protection for late, already-settled uncertain results. */
export class UxpReplayTombstones {
  private readonly entries = new Map<string, ReplayTombstone>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  has(id: string): boolean {
    this.prune();
    const entry = this.entries.get(id);
    if (!entry) return false;
    // Refresh recency without extending the fixed expiry window.
    this.entries.delete(id);
    this.entries.set(id, entry);
    return true;
  }

  add(id: string): void {
    this.prune();
    const existing = this.entries.get(id);
    if (existing) {
      this.entries.delete(id);
      this.bytes -= existing.bytes;
    }
    const bytes = Buffer.byteLength(id, 'utf8');
    if (bytes > this.maxBytes) return;
    while (
      this.entries.size >= this.maxEntries ||
      (this.entries.size > 0 && this.bytes + bytes > this.maxBytes)
    ) {
      const oldest = this.entries.entries().next().value as [string, ReplayTombstone] | undefined;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
    }
    this.entries.set(id, { bytes, expiresAt: this.now() + this.ttlMs });
    this.bytes += bytes;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }

  get retainedBytes(): number {
    this.prune();
    return this.bytes;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt > now) continue;
      this.entries.delete(id);
      this.bytes -= entry.bytes;
    }
  }
}
