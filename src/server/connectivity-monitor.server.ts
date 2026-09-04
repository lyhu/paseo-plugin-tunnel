import { createHash } from "node:crypto";
import type { PersistedTunnelConfig } from "./config.server.js";
import type {
  Connectivity,
  TunnelState,
} from "../shared/tunnel-types.shared.js";
import { checkOffer, checkOrigin } from "./connectivity.server.js";

interface Entry {
  fingerprint: string;
  result: Connectivity;
  controller: AbortController;
  run: () => Promise<number | null>;
  pending: boolean;
  started: boolean;
}
const INTERVAL_MS = 15000;

// Demand-driven and shared across clients: at most four active probes per plugin.
export class ConnectivityMonitor {
  #entries = new Map<string, Entry>();
  #active = 0;
  #closed = false;

  snapshot(state: TunnelState, config: PersistedTunnelConfig): TunnelState {
    const seen = new Set<string>();
    const sample = (
      id: string,
      fingerprint: string,
      blocked: Connectivity["reason"] | null,
      probe: (signal: AbortSignal) => Promise<number | null>,
    ): Connectivity => {
      seen.add(id);
      const previous = this.#entries.get(id);
      if (previous?.fingerprint !== fingerprint) {
        previous?.controller.abort();
        this.#entries.delete(id);
      }
      if (blocked)
        return {
          state: "offline",
          reason: blocked,
          checkedAt: null,
          httpStatus: null,
        };
      let entry = this.#entries.get(id);
      if (
        !entry ||
        (!entry.pending &&
          Date.now() - (entry.result.checkedAt ?? 0) >= INTERVAL_MS)
      ) {
        const controller = new AbortController();
        entry = {
          fingerprint,
          controller,
          pending: true,
          started: false,
          result:
            entry && Date.now() - (entry.result.checkedAt ?? 0) < 30000
              ? entry.result
              : {
                  state: "checking",
                  reason: "checking",
                  checkedAt: null,
                  httpStatus: null,
                },
          run: () => probe(controller.signal),
        };
        this.#entries.set(id, entry);
      }
      if (
        entry.pending &&
        entry.result.checkedAt !== null &&
        Date.now() - entry.result.checkedAt >= 30000
      ) {
        return {
          state: "checking",
          reason: "checking",
          checkedAt: null,
          httpStatus: null,
        };
      }
      return entry.result;
    };
    const result: TunnelState = {
      ...state,
      ingresses: state.ingresses.map((entry) => ({
        ...entry,
        connectivity: sample(
          `ingress:${entry.id}`,
          JSON.stringify([entry.targetOrigin, entry.status]),
          !entry.enabled
            ? "disabled"
            : entry.status !== "ready"
              ? "relay"
              : null,
          (signal) => checkOrigin(entry.targetOrigin, signal),
        ),
      })),
      egresses: state.egresses.map((entry) => {
        const rule = config.egresses?.find((rule) => rule.id === entry.id);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([rule, entry.status]))
          .digest("hex");
        return {
          ...entry,
          connectivity: sample(
            `egress:${entry.id}`,
            fingerprint,
            !entry.enabled
              ? "disabled"
              : entry.status !== "listening" ||
                  !entry.access.configured ||
                  !rule
                ? "listener"
                : null,
            (signal) =>
              rule ? checkOffer(rule.offer, signal) : Promise.resolve(null),
          ),
        };
      }),
    };
    for (const [id, entry] of this.#entries)
      if (!seen.has(id)) {
        entry.controller.abort();
        this.#entries.delete(id);
      }
    this.#drain();
    return result;
  }

  stop() {
    this.#closed = true;
    for (const entry of this.#entries.values()) entry.controller.abort();
    this.#entries.clear();
  }

  #drain() {
    if (this.#closed) return;
    for (const [id, entry] of this.#entries) {
      if (this.#active >= 4) return;
      if (!entry.pending || entry.started) continue;
      entry.started = true;
      this.#active++;
      void entry
        .run()
        .catch(() => null)
        .then((status) => {
          if (this.#entries.get(id) !== entry) return;
          entry.pending = false;
          entry.result = {
            state: status === null ? "offline" : "online",
            reason: status === null ? "unreachable" : "verified",
            checkedAt: Date.now(),
            httpStatus: status,
          };
        })
        .finally(() => {
          this.#active--;
          this.#drain();
        });
    }
  }
}
