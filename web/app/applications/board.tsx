"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useState } from "react";
import { setStatus } from "../actions";
import type { Application } from "../db";
import { STATUSES, STATUS_META, type Status } from "../pipeline";
import { Toasts, type Toast } from "../ui";

function hue(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i += 1) hash = (hash * 31 + company.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 45%)`;
}

function since(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return `${days}d`;
}

export function Board({ rows }: { rows: Application[] }) {
  // the board is optimistic for the same reason the queue is: dragging a card
  // should not wait for Postgres
  const [moved, setMoved] = useState<Map<string, Status>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const statusOf = useCallback(
    (row: Application) => moved.get(row.fingerprint) ?? row.status,
    [moved],
  );

  const move = useCallback(
    (row: Application, next: Status) => {
      const previous = statusOf(row);
      if (previous === next) return;

      setMoved((current) => new Map(current).set(row.fingerprint, next));
      void setStatus(row.fingerprint, next).then((result) => {
        if (result.ok) return;
        setMoved((current) => {
          const back = new Map(current);
          back.set(row.fingerprint, previous);
          return back;
        });
        setToasts((current) => [
          ...current,
          { id: Date.now(), what: "Could not move", detail: `${row.company} — ${result.error}` },
        ]);
      });
    },
    [statusOf],
  );

  return (
    <div className="page">
      <div className="kanban">
        {STATUSES.map((status) => {
          const cards = rows.filter((row) => statusOf(row) === status);
          return (
            <div
              className="column"
              key={status}
              style={{ "--state": STATUS_META[status].colour } as React.CSSProperties}
              data-over={over === status && dragging !== null}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((current) => (current === status ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const fingerprint = event.dataTransfer.getData("text/plain") || dragging;
                const row = rows.find((entry) => entry.fingerprint === fingerprint);
                if (row) move(row, status);
                setDragging(null);
              }}
            >
              <header>
                <span className="swatch" />
                {STATUS_META[status].label}
                <span className="n mono">{cards.length}</span>
              </header>
              <p className="blurb">{STATUS_META[status].blurb}</p>

              <AnimatePresence initial={false}>
                {cards.map((row, index) => {
                  const position = STATUSES.indexOf(statusOf(row));
                  return (
                    <motion.div
                      key={row.fingerprint}
                      layout
                      className="kcard"
                      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      draggable
                      onDragStart={(event) => {
                        setDragging(row.fingerprint);
                        (event as unknown as DragEvent).dataTransfer?.setData("text/plain", row.fingerprint);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                        <span
                          className="logo"
                          style={{ background: hue(row.company), width: 26, height: 26, flex: "0 0 26px", fontSize: 12, borderRadius: 8 }}
                          aria-hidden="true"
                        >
                          {row.company.trim().charAt(0).toUpperCase()}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <Link href={`/jobs/${row.fingerprint}`}>
                            <b>{row.title}</b>
                          </Link>
                          <span className="co">{row.company}</span>
                        </span>
                      </div>

                      <div className="meta">
                        <span className="pill mono">{row.score}</span>
                        {row.salary_text ? <span className="pill brand">{row.salary_text}</span> : null}
                        {since(row.applied_at) ? (
                          <span className="pill" title="time since you applied">
                            {since(row.applied_at)}
                          </span>
                        ) : null}
                      </div>

                      {row.note ? (
                        <p style={{ margin: "8px 0 0", color: "var(--slate)", fontSize: 11.5 }}>{row.note}</p>
                      ) : null}

                      <div className="move">
                        <button
                          type="button"
                          disabled={position === 0}
                          onClick={() => move(row, STATUSES[position - 1]!)}
                          aria-label="Move back"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          disabled={position === STATUSES.length - 1}
                          onClick={() => move(row, STATUSES[position + 1]!)}
                          aria-label="Move forward"
                        >
                          →
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {cards.length === 0 ? (
                <p style={{ color: "var(--faint)", fontSize: 11.5, textAlign: "center", padding: "14px 0" }}>
                  Drop here
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((c) => c.filter((t) => t.id !== id))} />
    </div>
  );
}
