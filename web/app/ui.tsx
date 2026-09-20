"use client";

import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/** Everything in this tool is under a quarter of a second. */
export const FAST = 0.14;
export const NORMAL = 0.18;
export const SLOW = 0.24;

/** Score numbers count up on mount. Reduced motion gets the final value. */
export function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, {
      duration: SLOW,
      ease: "easeOut",
      onUpdate: (next) => setShown(Math.round(next)),
    });
    return () => controls.stop();
  }, [value, reduce]);

  return <>{shown}</>;
}

/** A number that flicks over when it changes, so a moving count is noticeable. */
export function Ticker({ value }: { value: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{value}</>;

  return (
    <span style={{ display: "inline-grid", overflow: "hidden" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ duration: FAST, ease: "easeOut" }}
          style={{ gridArea: "1 / 1" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export type Toast = { id: number; what: string; detail: string };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: NORMAL, ease: "easeOut" }}
          >
            <span className="what">{toast.what}</span>
            <span className="mono" style={{ color: "var(--slate)" }}>
              {toast.detail}
            </span>
            <button className="iconbtn" style={{ marginLeft: "auto" }} onClick={() => onDismiss(toast.id)}>
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["j / ↓", "next row"],
  ["k / ↑", "previous row"],
  ["i", "interested"],
  ["n", "not for me"],
  ["o", "open the posting"],
  ["u", "undo last decision"],
  ["/", "focus filter search"],
  ["?", "this list"],
  ["esc", "close / blur"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: FAST }}
    >
      <motion.div
        className="keys"
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: NORMAL, ease: "easeOut" }}
      >
        <h2>Keyboard</h2>
        <dl>
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt>
                {key.split(" / ").map((part, index) => (
                  <span key={part}>
                    {index > 0 ? " / " : ""}
                    <kbd>{part}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </motion.div>
  );
}
