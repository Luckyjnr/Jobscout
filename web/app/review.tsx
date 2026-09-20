"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decide as decideAction, saveNote as saveNoteAction, undecide as undecideAction } from "./actions";
import type { Attribution, Row as RowData, Totals } from "./db";
import { EMPTY, apply, countActive, facets as computeFacets, fromParams, toParams, type Filters } from "./filters";
import { JobRow, exitFor, type Decision } from "./row";
import { Sidebar } from "./sidebar";
import { FAST, NORMAL, Shortcuts, Ticker, Toasts, type Toast } from "./ui";

type View = "queue" | "interested";

type Undo = { row: RowData; decision: Decision };

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

export function Review({
  queue,
  interested,
  totals,
  attributions,
}: {
  queue: RowData[];
  interested: RowData[];
  totals: Totals;
  attributions: Attribution[];
}) {
  const reduce = useReducedMotion() ?? false;
  const mobile = useMediaQuery("(max-width: 900px)");

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [view, setView] = useState<View>("queue");
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [focus, setFocus] = useState(0);

  // fingerprints decided in this session, and ones sent back to the queue
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<Undo[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);

  // ---------------------------------------------------------------- url state

  // read once on mount; the URL is the source of truth for a shared link
  useEffect(() => {
    setFilters(fromParams(new URLSearchParams(window.location.search)));
  }, []);

  useEffect(() => {
    const params = toParams(filters).toString();
    const next = `${window.location.pathname}${params ? `?${params}` : ""}`;
    // replaceState, not the router: filtering is client-side and must not
    // trigger a server render on every keystroke
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next);
    }
  }, [filters]);

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setFocus(0);
  }, []);

  const reset = useCallback(() => {
    setFilters(EMPTY);
    setFocus(0);
  }, []);

  // ------------------------------------------------------------------- lists

  const byFingerprint = useMemo(() => {
    const map = new Map<string, RowData>();
    for (const row of [...queue, ...interested]) map.set(row.fingerprint, row);
    return map;
  }, [queue, interested]);

  const liveQueue = useMemo(() => {
    const returned = [...undone]
      .map((fingerprint) => byFingerprint.get(fingerprint))
      .filter((row): row is RowData => !!row && !decisions.has(row.fingerprint));
    const base = queue.filter((row) => !decisions.has(row.fingerprint));
    return [...returned, ...base].sort((a, b) => b.score - a.score);
  }, [queue, decisions, undone, byFingerprint]);

  const liveInterested = useMemo(() => {
    const added = [...decisions]
      .filter(([, decision]) => decision === "interested")
      .map(([fingerprint]) => byFingerprint.get(fingerprint))
      .filter((row): row is RowData => !!row);
    const base = interested.filter((row) => !undone.has(row.fingerprint) && !decisions.has(row.fingerprint));
    return [...added, ...base];
  }, [interested, decisions, undone, byFingerprint]);

  const source = view === "queue" ? liveQueue : liveInterested;
  const facets = useMemo(() => computeFacets(source, filters), [source, filters]);
  const rows = useMemo(() => apply(source, filters), [source, filters]);

  useEffect(() => {
    setFocus((current) => Math.max(0, Math.min(current, rows.length - 1)));
  }, [rows.length]);

  // --------------------------------------------------------------- decisions

  const toast = useCallback((what: string, detail: string) => {
    const id = (toastId.current += 1);
    setToasts((current) => [...current, { id, what, detail }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 6000);
  }, []);

  /** Optimistic: the row leaves now, the write happens after. */
  const onDecide = useCallback(
    (row: RowData, decision: Decision) => {
      setDecisions((current) => new Map(current).set(row.fingerprint, decision));
      setUndone((current) => {
        if (!current.has(row.fingerprint)) return current;
        const next = new Set(current);
        next.delete(row.fingerprint);
        return next;
      });
      setUndoStack((current) => [...current, { row, decision }]);

      void decideAction(row.fingerprint, decision).then((result) => {
        if (result.ok) return;
        // put it back exactly where it was and say why
        setDecisions((current) => {
          const next = new Map(current);
          next.delete(row.fingerprint);
          return next;
        });
        setUndoStack((current) => current.filter((entry) => entry.row.fingerprint !== row.fingerprint));
        toast("Could not save", `${row.company} — ${result.error}`);
      });
    },
    [toast],
  );

  const onUndoRow = useCallback(
    (row: RowData) => {
      setUndone((current) => new Set(current).add(row.fingerprint));
      setDecisions((current) => {
        const next = new Map(current);
        next.delete(row.fingerprint);
        return next;
      });
      setUndoStack((current) => current.filter((entry) => entry.row.fingerprint !== row.fingerprint));

      void undecideAction(row.fingerprint).then((result) => {
        if (result.ok) return;
        setUndone((current) => {
          const next = new Set(current);
          next.delete(row.fingerprint);
          return next;
        });
        toast("Could not undo", `${row.company} — ${result.error}`);
      });
    },
    [toast],
  );

  const undoLast = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    onUndoRow(last.row);
  }, [undoStack, onUndoRow]);

  const onSaveNote = useCallback(
    (row: RowData, note: string) => {
      void saveNoteAction(row.fingerprint, note).then((result) => {
        if (!result.ok) toast("Could not save note", `${row.company} — ${result.error}`);
      });
    },
    [toast],
  );

  // ---------------------------------------------------------------- keyboard

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        if (isTyping(event.target)) (event.target as HTMLElement).blur();
        setShowKeys(false);
        setSheetOpen(false);
        return;
      }

      if (isTyping(event.target)) return;

      // A held key auto-repeats. That is welcome for moving around and
      // catastrophic for deciding: leaning on "i" would clear the queue.
      const destructive = event.key === "i" || event.key === "n" || event.key === "u" || event.key === "o";
      if (event.repeat && destructive) return;

      const row = rows[focus];

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setFocus((current) => Math.min(current + 1, rows.length - 1));
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setFocus((current) => Math.max(current - 1, 0));
          break;
        case "i":
          if (row && view === "queue") onDecide(row, "interested");
          break;
        case "n":
          if (row && view === "queue") onDecide(row, "rejected");
          break;
        case "o":
          if (row) window.open(row.url, "_blank", "noopener,noreferrer");
          break;
        case "u":
          undoLast();
          break;
        case "/":
          event.preventDefault();
          setSheetOpen(true);
          setCollapsed(false);
          // the field may have just been mounted by opening the sheet
          requestAnimationFrame(() => searchRef.current?.focus());
          break;
        case "?":
          setShowKeys((current) => !current);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, focus, view, onDecide, undoLast]);

  // ------------------------------------------------------------------ counts

  const decidedToday =
    totals.decidedToday + decisions.size - [...undone].filter((fp) => !decisions.has(fp)).length;
  const aboveFifty = rows.filter((row) => row.score > 50).length;

  // sources whose terms require visible credit, by source name
  const credits = useMemo(
    () => new Map(attributions.map((entry) => [entry.source, entry])),
    [attributions],
  );

  const sidebar = (
    <Sidebar filters={filters} facets={facets} update={update} reset={reset} searchRef={searchRef} />
  );

  return (
    <div className="shell" data-collapsed={collapsed && !mobile}>
      {mobile ? (
        <AnimatePresence>
          {sheetOpen ? (
            <>
              <motion.div
                className="scrim"
                onClick={() => setSheetOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: FAST }}
              />
              <motion.aside
                className="sidebar"
                initial={reduce ? false : { y: "100%" }}
                animate={{ y: 0 }}
                exit={reduce ? undefined : { y: "100%" }}
                transition={{ duration: NORMAL, ease: "easeOut" }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.4 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 120) setSheetOpen(false);
                }}
              >
                {sidebar}
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>
      ) : (
        <AnimatePresence initial={false}>
          {collapsed ? null : (
            <motion.aside
              className="sidebar"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: FAST }}
            >
              {sidebar}
            </motion.aside>
          )}
        </AnimatePresence>
      )}

      <div className="main">
        <div className="topstrip">
          {!mobile ? (
            <button
              className="iconbtn"
              onClick={() => setCollapsed((value) => !value)}
              title={collapsed ? "Show filters" : "Hide filters"}
              type="button"
            >
              {collapsed ? "»" : "«"}
            </button>
          ) : null}

          <div className="stat">
            <span className="value mono">
              <Ticker value={rows.length} />
            </span>
            <span className="label">{view === "queue" ? "in queue" : "interested"}</span>
          </div>

          <div className="stat good">
            <span className="value mono">
              <Ticker value={aboveFifty} />
            </span>
            <span className="label">above 50</span>
          </div>

          <div className="stat">
            <span className="value mono">
              <Ticker value={decidedToday} />
            </span>
            <span className="label">decided today</span>
          </div>

          <div className="sources mono">
            {facets.sources.map((entry) => (
              <span key={entry.value}>
                {entry.value} <b>{entry.count}</b>
              </span>
            ))}
          </div>

          <div className="viewtabs">
            <button data-on={view === "queue"} onClick={() => setView("queue")} type="button">
              Queue
            </button>
            <button data-on={view === "interested"} onClick={() => setView("interested")} type="button">
              Interested
            </button>
          </div>

          <button className="iconbtn" onClick={() => setShowKeys(true)} title="Shortcuts (?)" type="button">
            ?
          </button>
        </div>

        <div className="queue">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((row, index) => (
              <motion.div
                key={row.fingerprint}
                exit={exitFor(decisions.get(row.fingerprint), reduce)}
                style={{ minWidth: 0 }}
              >
                <JobRow
                  row={row}
                  credit={row.sources.map((s) => credits.get(s)).find(Boolean) ?? null}
                  index={index}
                  focused={index === focus}
                  view={view}
                  swipeable={mobile}
                  onFocus={setFocus}
                  onDecide={onDecide}
                  onUndo={onUndoRow}
                  onSaveNote={onSaveNote}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {rows.length === 0 ? (
            <div className="empty">
              <b>{view === "queue" ? "Queue clear" : "Nothing marked interested"}</b>
              {countActive(filters) > 0 ? (
                <>
                  No role matches these filters.{" "}
                  <button className="act" onClick={reset} type="button" style={{ marginLeft: 6 }}>
                    Clear filters
                  </button>
                </>
              ) : view === "queue" ? (
                "Run the crawler, or everything here is decided."
              ) : (
                "Press i on a row in the queue."
              )}
            </div>
          ) : null}
        </div>
      </div>

      {mobile && !sheetOpen ? (
        <button className="fab" onClick={() => setSheetOpen(true)} type="button">
          Filters
          {countActive(filters) > 0 ? <span className="mono">{countActive(filters)}</span> : null}
        </button>
      ) : null}

      <AnimatePresence>{showKeys ? <Shortcuts onClose={() => setShowKeys(false)} /> : null}</AnimatePresence>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </div>
  );
}
