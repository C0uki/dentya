import type { PlayerAction } from "./types";

let pendingAction: ((a: PlayerAction) => void) | null = null;

export function waitAction(): Promise<PlayerAction> {
  return new Promise((res) => { pendingAction = res; });
}

export function resolveAction(a: PlayerAction): void {
  if (pendingAction) {
    const r = pendingAction;
    pendingAction = null;
    r(a);
  }
}
