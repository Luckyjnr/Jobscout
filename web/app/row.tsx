"use client";

import { motion, useReducedMotion, type PanInfo } from "framer-motion";
import { memo, useEffect, useRef, useState } from "react";
import type { Attribution, Row as RowData } from "./db";
import { CountUp, FAST, NORMAL } from "./ui";

export type Decision = "interested" | "rejected";

const MAX_LOCATIONS = 2;
const SWIPE_COMMIT = 90;

type Age = { label: string; band: "fresh" | "normal" | "stale" };

/** A job posted today and one posted in 2021 should not read the same. */
function age(value: string | null): Age {
  if (!value) return { label: "no date", band: "normal" };
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  if (days <= 0) return { label: "today", band: "fresh" };
  if (days === 1) return { label: "1d ago", band: "fresh" };
  if (days < 30) return { label: `${days}d ago`, band: "normal" };
  if (days < 365) return { label: `${Math.floor(days / 30)}mo ago`, band: "stale" };
  return { label: `${Math.floor(days / 365)}y ago`, band: "stale" };
}

/**
 * Avatar colour from the company name: the same employer keeps the same hue
 * across sessions and machines, which is the point of a colour you recognise
 * without reading.
 */
function avatarStyle(company: string): { background: string } {
  let hash = 0;
  for (let index = 0; index < company.length; index += 1) {
    hash = (hash * 31 + company.charCodeAt(index)) % 360;
  }
  return { background: `hsl(${hash} 52% 45%)` };
}

function initial(company: string): string {
  const letter = [...company.trim()].find((character) => /\p{L}|\p{N}/u.test(character));
  return (letter ?? "?").toUpperCase();
}

function locationLine(row: RowData): string | null {
  if (row.locations.length === 0) return null;
  const shown = row.locations.slice(0, MAX_LOCATIONS).join(" · ");
  const rest = row.locations.length - MAX_LOCATIONS;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

export const JobRow = memo(function JobRow({
  row,
  credit,
  index,
  focused,
  view,
  swipeable,
  onFocus,
  onDecide,
  onUndo,
  onSaveNote,
}: {
  row: RowData;
  /** set when this row's feed requires visible credit */
  credit: Attribution | null;
  index: number;
  focused: boolean;
  view: "queue" | "interested";
  swipeable: boolean;
  onFocus: (index: number) => void;
  onDecide: (row: RowData, decision: Decision) => void;
  onUndo: (row: RowData) => void;
  onSaveNote: (row: RowData, note: string) => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState(row.note ?? "");
  const [dragging, setDragging] = useState(false);
  const posted = age(row.posted_at);
  const location = locationLine(row);

  // scroll follows focus, and only when this card is the one focused
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [focused, reduce]);

  const stagger = reduce ? 0 : Math.min(index, 18) * 0.02;

  function onDragEnd(_: unknown, info: PanInfo) {
    setDragging(false);
    if (view !== "queue") return;
    if (info.offset.x > SWIPE_COMMIT) onDecide(row, "interested");
    else if (info.offset.x < -SWIPE_COMMIT) onDecide(row, "rejected");
  }

  return (
    <motion.article
      ref={ref}
      layout={reduce ? false : "position"}
      className="card"
      data-focused={focused}
      onMouseDown={() => onFocus(index)}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: NORMAL, ease: "easeOut", delay: stagger }}
      drag={swipeable && view === "queue" ? "x" : false}
      dragSnapToOrigin
      dragElastic={0.5}
      dragDirectionLock
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
    >
      {swipeable && view === "queue" ? (
        <>
          {/* only while the card is actually moving; otherwise they sit on top
              of the content the whole time */}
          <span className="swipe-hint left" data-on={dragging}>
            interested →
          </span>
          <span className="swipe-hint right" data-on={dragging}>
            ← not for me
          </span>
        </>
      ) : null}

      <div className="card-top">
        <div className="avatar" style={avatarStyle(row.company)} aria-hidden="true">
          {initial(row.company)}
        </div>

        <div className="card-head">
          <div className="title">
            <a href={row.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
              {row.title}
            </a>
          </div>
          <div className="company">{row.company}</div>
        </div>

        <div className="score-pill mono">
          <CountUp value={row.score} />
          {row.fit === null ? null : <span className="fit">fit {row.fit}</span>}
        </div>
      </div>

      <div className="tags">
        {location ? <span className="tag">{location}</span> : null}
        {row.remote ? <span className="tag remote">Remote</span> : null}
        <span className="tag" data-band={posted.band}>
          {posted.label}
        </span>
        <span className="tag">{row.sources.join("/")}</span>
        {row.postings > 1 ? <span className="tag">{row.postings} postings</span> : null}
      </div>

      <div className="sig">
        {row.signals.map((signal, order) => (
          <span key={signal.name} className={signal.weight < 0 ? "neg" : undefined}>
            {order > 0 ? " · " : ""}
            {signal.weight >= 0 ? "+" : ""}
            {signal.weight} {signal.name}
            {signal.evidence ? ` (${signal.evidence})` : ""}
          </span>
        ))}
      </div>

      <div className="card-bottom">
        {row.salary_text ? (
          <span className="salary">{row.salary_text}</span>
        ) : (
          <span className="salary none">Salary not stated</span>
        )}

        {credit ? (
          <a
            className="credit"
            href={credit.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            {credit.text}
          </a>
        ) : null}

        <div className="acts">
          {view === "queue" ? (
            <>
              <button className="act no" type="button" onClick={() => onDecide(row, "rejected")}>
                Not for me
              </button>
              <button className="act yes" type="button" onClick={() => onDecide(row, "interested")}>
                Interested
              </button>
            </>
          ) : (
            <button className="act ghost" type="button" onClick={() => onUndo(row)}>
              Undo
            </button>
          )}
        </div>
      </div>

      {view === "interested" ? (
        <div className="note">
          <textarea
            rows={1}
            placeholder="Add a note…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur();
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSaveNote(row, note);
                event.currentTarget.blur();
              }
            }}
          />
          <button
            className="act ghost"
            type="button"
            onClick={() => onSaveNote(row, note)}
            disabled={note === (row.note ?? "")}
            style={{ opacity: note === (row.note ?? "") ? 0.45 : 1 }}
          >
            Save
          </button>
        </div>
      ) : null}
    </motion.article>
  );
});

/** The animation a card leaves by: right for interested, left for rejected. */
export function exitFor(decision: Decision | undefined, reduce: boolean) {
  if (reduce) return { opacity: 0 };
  const direction = decision === "rejected" ? -1 : 1;
  return {
    opacity: 0,
    scale: 0.96,
    x: direction * 120,
    transition: { duration: FAST, ease: "easeIn" as const },
  };
}
