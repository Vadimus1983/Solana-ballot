/** Browser Notification permission helpers and status-change messages. */

const ICON = "/vite.svg";

/** Returns true if the browser supports the Notification API. */
export function notificationsSupported(): boolean {
  return "Notification" in window;
}

/** Returns the current permission state. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

/**
 * Requests browser notification permission.
 * Returns true if the user granted it (or it was already granted).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Fires a browser notification if permission is granted. No-ops otherwise. */
export function notify(title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: ICON });
  } catch {
    // Some browsers block Notification outside a secure context — ignore silently.
  }
}

// ── Status-change messages ────────────────────────────────────────────────────

interface StatusMessage {
  title: string;
  body: string;
}

const STATUS_MESSAGES: Record<string, StatusMessage> = {
  voting: {
    title: "Voting is now open",
    body: "The proposal has moved to the Voting phase. Cast your ZK vote now.",
  },
  closed: {
    title: "Voting has closed",
    body: "Reveal your vote within 24 hours or it will not be counted in the tally.",
  },
  finalized: {
    title: "Tally is final",
    body: "The proposal has been finalized. Check the Results tab for the outcome.",
  },
  expired: {
    title: "Proposal expired",
    body: "The proposal expired without opening for voting. No tally will be produced.",
  },
};

/**
 * Fires a browser notification appropriate to the new proposal status.
 * Silent no-op for statuses with no configured message (e.g. "registration").
 */
export function notifyStatusChange(newStatus: string): void {
  const msg = STATUS_MESSAGES[newStatus];
  if (msg) notify(msg.title, msg.body);
}
