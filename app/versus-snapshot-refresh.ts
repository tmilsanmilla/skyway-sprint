import { PeerInvalidationDispatcher } from "./realtime-peer-limits.ts";

export type VersusSnapshotRefresh = { request: () => void; close: () => void };
type DispatcherArguments = ConstructorParameters<typeof PeerInvalidationDispatcher>;

/** Peer hints, reconnect notices and fallback polling share one background
 * read. Keep one trailing refresh so events during a slow read are not lost. */
export function createVersusSnapshotRefresh(
  refresh: () => Promise<void>,
  isCurrent: () => boolean,
  timing: {
    now?: DispatcherArguments[1];
    schedule?: DispatcherArguments[2];
    cancel?: DispatcherArguments[3];
  } = {},
): VersusSnapshotRefresh {
  const dispatcher = new PeerInvalidationDispatcher(async () => {
    if (isCurrent()) await refresh();
  }, timing.now, timing.schedule, timing.cancel);
  return {
    request() { if (isCurrent()) dispatcher.enqueue(["match"]); },
    close() { dispatcher.close(); },
  };
}
