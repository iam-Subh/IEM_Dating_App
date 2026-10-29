import { navigationRef } from "../../navigation/navigationRef";
import { verifyReasonOf } from "../verification/verifyGate";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState } from "react-native";
import { api } from "../../services/api";

export type RoseBalance = {
  roses: number;
  grant: number;
  perDayLimit: number;
  refreshesAt: string;
  /** Before verifying: the one trial Rose (GOOGLE_SIGNUP_PLAN.md 2.5). */
  trial?: boolean;
};

/**
 * The Rose balance, one count for the whole app (EXPLORE_SPEC.md, section 10).
 * The deck, Explore, Search and Standouts can all send a Rose, and they stay
 * mounted side by side, so each keeping its own copy left the others showing
 * the old number after a Rose was sent from one of them. They all read this
 * one store instead.
 *
 * The server is authoritative - it spends the Rose inside the swipe
 * transaction - so the store keeps an optimistic count only to render the
 * badge, and re-reads after anything it did not predict.
 */
let shared: RoseBalance | null = null;
const listeners = new Set<(balance: RoseBalance | null) => void>();
let inFlight: Promise<void> | null = null;
/** Bumped on logout, so a read started for the last account is dropped. */
let session = 0;

function publish(next: RoseBalance | null) {
  shared = next;
  for (const listener of listeners) listener(next);
}

/** Re-reads the balance once, however many screens ask at the same moment. */
function refreshShared(): Promise<void> {
  const started = session;
  inFlight ??= api
    .get("/discover/roses")
    .then((response) => {
      if (started === session) publish(response.data.data ?? null);
    })
    .catch(() => {
      // A missing balance renders as "checking", never as zero - telling
      // someone they have no Roses because a request failed is a lie.
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** One Rose spent: every screen's badge goes down together. */
function spendOne() {
  if (shared) publish({ ...shared, roses: Math.max(0, shared.roses - 1) });
}

/** On logout: the next account must never see this one's count. */
export function resetRoses() {
  session += 1;
  inFlight = null;
  publish(null);
}

export function useRoses() {
  const [balance, setBalance] = useState<RoseBalance | null>(shared);

  useEffect(() => {
    listeners.add(setBalance);
    setBalance(shared);
    return () => {
      listeners.delete(setBalance);
    };
  }, []);

  const refresh = useCallback(() => refreshShared(), []);

  // Read on mount, and whenever the app comes back: the weekly top-up may
  // have happened while it was away.
  useEffect(() => {
    void refreshShared();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshShared();
    });
    return () => subscription.remove();
  }, []);

  /**
   * Sends a Rose. Returns the swipe result on success and null once it has
   * explained the refusal, so callers only handle the happy path.
   */
  const send = useCallback(
    async (targetId: string, comment: string | null, options?: {onTrialRoseSpent?: () => void; about?: {kind: "photo"; photoUrl: string} | {kind: "bio"}}) => {
      try {
        const response = await api.post("/discover/swipe", {
          targetId,
          action: "like",
          rose: true,
          ...(comment ? { comment } : {}),
          // Sent from the comment sheet: what the note is about (a photo, or the bio).
          ...(comment && options?.about ? { about: options.about } : {}),
        });
        // A replayed swipe spent nothing on the server, so read rather than guess.
        if (response.data.data?.repeated) void refreshShared();
        else spendOne();
        // The trial Rose of an unverified account (GOOGLE_SIGNUP_PLAN.md 2.5):
        // "Nice choice - verified students get 5 Roses every week."
        if (!response.data.data?.repeated && shared?.trial && navigationRef.isReady()) {
          if (options?.onTrialRoseSpent) options.onTrialRoseSpent();
          else setTimeout(() => navigationRef.navigate("VerifyRules", { reason: "roseSent" }), 600);
        }
        return response.data.data ?? {};
      } catch (error: any) {
        // Out of trial Roses: the rules screen already answered.
        if (verifyReasonOf(error)) { refresh(); return null; }
        const code = error?.response?.data?.code;
        const message =
          error?.response?.data?.message ??
          "That Rose could not be sent. Try again in a moment.";
        Alert.alert(
          code === "NO_ROSES_LEFT"
            ? "Out of Roses"
            : code === "ROSE_ALREADY_SENT"
              ? "Already sent"
              : code === "ROSE_NOT_FIRST"
                ? "Already liked"
              : code === "ROSE_DAILY_LIMIT"
                ? "That's today's Roses"
                : code === "ROSE_COMMENT_REJECTED"
                  ? "Edit your note"
                  : "Couldn't send",
          message,
        );
        // Any refusal may have moved the real balance, so stop guessing at it.
        refresh();
        return null;
      }
    },
    [refresh],
  );

  return { balance, refresh, send };
}
