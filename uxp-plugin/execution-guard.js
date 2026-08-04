/**
 * Serializes UXP execution and makes an expired watchdog fail closed.
 *
 * batchPlay is not cancellable. A watchdog can tell us that its result is no
 * longer timely, but it cannot tell us that Photoshop stopped mutating. Once a
 * watchdog expires, this plugin instance remains quarantined until the bridge
 * process restarts and the plugin reloads with a fresh handshake.
 */
class ExecutionGuard {
  constructor({ onUncertain, onSettled, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.onUncertain = onUncertain;
    this.onSettled = onSettled;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.activeId = null;
    this.quarantined = false;
  }

  isBusy() {
    return this.activeId !== null;
  }

  isQuarantined() {
    return this.quarantined;
  }

  /**
   * Start exactly one underlying Photoshop operation. Returns false when a
   * caller tries to overlap it or when a previous operation is uncertain.
   */
  start(id, execute, watchdogMs) {
    if (this.activeId !== null || this.quarantined) return false;

    this.activeId = id;
    let settled = false;
    const watchdog = this.setTimer(() => {
      if (settled) return;
      this.quarantined = true;
      // This is intentionally *not* a terminal {ok:false} result. The real
      // promise may still mutate Photoshop and is the only authority that can
      // produce a terminal result for this command id.
      void Promise.resolve(this.onUncertain(id)).catch(() => undefined);
    }, watchdogMs);

    // Defer invocation until after admission so a rejected second command never
    // even calls batchPlay.
    Promise.resolve()
      .then(execute)
      .then(
        (data) => this.settle(id, { id, ok: true, data }, watchdog, () => (settled = true)),
        (error) =>
          this.settle(
            id,
            { id, ok: false, error: error?.message || String(error) },
            watchdog,
            () => (settled = true)
          )
      );
    return true;
  }

  settle(id, result, watchdog, markSettled) {
    markSettled();
    this.clearTimer(watchdog);
    if (this.activeId === id) this.activeId = null;
    // Even after a late settlement, quarantine remains set. The only supported
    // Recovery requires bridge-process restart, then plugin reload and a fresh
    // handshake, which construct a new guard/session.
    void Promise.resolve(this.onSettled(result)).catch(() => undefined);
  }
}

module.exports = { ExecutionGuard };
