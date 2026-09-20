"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
import {
  CHIPS,
  EMPTY,
  POSTED_OPTIONS,
  QUEUE_FLOOR,
  SCORE_CEILING,
  SCORE_FLOOR,
  countActive,
  type Facets,
  type Filters,
} from "./filters";
import { FAST, Ticker } from "./ui";

type Update = (patch: Partial<Filters>) => void;

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Group({
  title,
  active,
  children,
  defaultOpen = true,
}: {
  title: string;
  active: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduce = useReducedMotion();

  return (
    <section className="group">
      <header
        role="button"
        tabIndex={0}
        data-open={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        <span className="chev">▾</span>
        {title}
        {active > 0 ? <span className="badge">{active}</span> : null}
      </header>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: FAST, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="group-body">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function Option({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button className="opt" data-on={on} data-zero={count === 0 && !on} onClick={onClick} type="button">
      <span className="box">{on ? <span style={{ fontSize: 9, lineHeight: 1 }}>✓</span> : null}</span>
      <span className="name">{label}</span>
      <span className="n mono">
        <Ticker value={count} />
      </span>
    </button>
  );
}

export function Sidebar({
  filters,
  facets,
  update,
  reset,
  searchRef,
}: {
  filters: Filters;
  facets: Facets;
  update: Update;
  reset: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [companyQuery, setCompanyQuery] = useState("");

  const companies = useMemo(() => {
    const query = companyQuery.trim().toLowerCase();
    const matching = query
      ? facets.companies.filter((entry) => entry.value.toLowerCase().includes(query))
      : facets.companies;
    // anything already chosen stays visible even when it does not match
    const chosen = facets.companies.filter((entry) => filters.companies.includes(entry.value));
    const seen = new Set(matching.map((entry) => entry.value));
    return [...matching, ...chosen.filter((entry) => !seen.has(entry.value))].slice(0, 120);
  }, [facets.companies, companyQuery, filters.companies]);

  const spread = SCORE_CEILING - SCORE_FLOOR;
  const left = ((filters.scoreMin - SCORE_FLOOR) / spread) * 100;
  const right = ((filters.scoreMax - SCORE_FLOOR) / spread) * 100;

  return (
    <div className="sidebar-inner">
      <div className="sheet-handle" />

      <div className="filter-head">
        <span className="dot" />
        <h2>Filters</h2>
        {countActive(filters) > 0 ? (
          <button className="clear" onClick={reset} type="button">
            clear {countActive(filters)}
          </button>
        ) : null}
      </div>

      <Group title="Location" active={filters.chips.length + (filters.q ? 1 : 0)}>
        <input
          ref={searchRef}
          className="field"
          placeholder="Search location, title, company…"
          value={filters.q}
          onChange={(event) => update({ q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
        <div className="chips">
          {CHIPS.map((chip) => {
            const count = facets.chips.find((entry) => entry.value === chip.id)?.count ?? 0;
            return (
              <button
                key={chip.id}
                className="chip"
                type="button"
                data-on={filters.chips.includes(chip.id)}
                onClick={() => update({ chips: toggle(filters.chips, chip.id) })}
              >
                {chip.label}
                <span className="n mono">{count}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Score" active={filters.scoreMin !== EMPTY.scoreMin || filters.scoreMax !== EMPTY.scoreMax ? 1 : 0}>
        {/* the queue hides everything under QUEUE_FLOOR unless asked otherwise */}
        <button
          className="toggle"
          type="button"
          data-on={filters.showAll}
          onClick={() => update({ showAll: !filters.showAll })}
        >
          <span className="switch" aria-hidden="true">
            <span className="knob" />
          </span>
          <span className="name">
            {filters.showAll ? `Showing everything` : `Hiding under ${QUEUE_FLOOR}`}
          </span>
          <span className="n mono">
            <Ticker value={facets.belowFloor} />
          </span>
        </button>

        <div className="range">
          <div className="ends mono">
            <span>{filters.scoreMin}</span>
            <span>{filters.scoreMax}</span>
          </div>
          <div className="track">
            <span className="rail" />
            <span className="fill" style={{ left: `${left}%`, right: `${100 - right}%` }} />
            <input
              type="range"
              min={SCORE_FLOOR}
              max={SCORE_CEILING}
              value={filters.scoreMin}
              aria-label="Minimum score"
              onChange={(event) =>
                update({ scoreMin: Math.min(Number(event.target.value), filters.scoreMax) })
              }
            />
            <input
              type="range"
              min={SCORE_FLOOR}
              max={SCORE_CEILING}
              value={filters.scoreMax}
              aria-label="Maximum score"
              onChange={(event) =>
                update({ scoreMax: Math.max(Number(event.target.value), filters.scoreMin) })
              }
            />
          </div>
        </div>
      </Group>

      <Group title="Company" active={filters.companies.length}>
        <input
          className="field"
          placeholder="Filter companies…"
          value={companyQuery}
          onChange={(event) => setCompanyQuery(event.target.value)}
        />
        <div className="scrolled">
          {companies.map((entry) => (
            <Option
              key={entry.value}
              label={entry.value}
              count={entry.count}
              on={filters.companies.includes(entry.value)}
              onClick={() => update({ companies: toggle(filters.companies, entry.value) })}
            />
          ))}
          {companies.length === 0 ? <span className="opt">no match</span> : null}
        </div>
      </Group>

      <Group title="Source" active={filters.sources.length}>
        {facets.sources.map((entry) => (
          <Option
            key={entry.value}
            label={entry.value}
            count={entry.count}
            on={filters.sources.includes(entry.value)}
            onClick={() => update({ sources: toggle(filters.sources, entry.value) })}
          />
        ))}
      </Group>

      <Group title="Salary" active={filters.salary === "any" ? 0 : 1}>
        <Option
          label="Has salary published"
          count={facets.salary.yes}
          on={filters.salary === "yes"}
          onClick={() => update({ salary: filters.salary === "yes" ? "any" : "yes" })}
        />
        <Option
          label="No salary"
          count={facets.salary.no}
          on={filters.salary === "no"}
          onClick={() => update({ salary: filters.salary === "no" ? "any" : "no" })}
        />
      </Group>

      <Group title="Posted" active={filters.posted === "any" ? 0 : 1}>
        {POSTED_OPTIONS.map((option) => (
          <Option
            key={option.id}
            label={option.label}
            count={facets.posted.find((entry) => entry.value === option.id)?.count ?? 0}
            on={filters.posted === option.id}
            onClick={() => update({ posted: option.id })}
          />
        ))}
      </Group>

      <Group title="Signals" active={filters.signals.length} defaultOpen={false}>
        <div className="scrolled">
          {facets.signals.map((entry) => (
            <Option
              key={entry.value}
              label={entry.value}
              count={entry.count}
              on={filters.signals.includes(entry.value)}
              onClick={() => update({ signals: toggle(filters.signals, entry.value) })}
            />
          ))}
        </div>
      </Group>
    </div>
  );
}
