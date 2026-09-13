import { toast } from "sonner";

export type NotifyMode = "toast" | "status";
export type NotifyType = "success" | "error" | "info";

export type NotifyOptions = {
  description?: string;
  icon?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type StatusSink = (message: string) => void;

let mode: NotifyMode = "toast";
let statusSink: StatusSink | null = null;

/** Switch between popup toasts and status-bar-only notifications. */
export function setNotifyMode(next: NotifyMode) {
  mode = next;
}

/** Register (or clear, with null) where "status" mode messages are delivered. */
export function setStatusSink(sink: StatusSink | null) {
  statusSink = sink;
}

/**
 * Show a notification. In "toast" mode this pops up a sonner toast at
 * bottom-left for 4s by default. In "status" mode the message is sent to the
 * status sink (e.g. the footer) instead of showing any popup.
 */
export function notify(type: NotifyType, message: string, opts?: NotifyOptions) {
  if (mode === "status") {
    statusSink?.(message);
    return;
  }
  toast[type](message, {
    position: "bottom-left",
    duration: opts?.duration ?? 4000,
    ...opts,
  });
}
