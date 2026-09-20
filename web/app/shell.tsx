"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NavCounts } from "./db";

const NAV = [
  { href: "/", glyph: "◈", label: "Dashboard" },
  { href: "/jobs", glyph: "▤", label: "Jobs", badge: "queue" as const },
  { href: "/applications", glyph: "▦", label: "Applications", badge: "applications" as const },
  { href: "/scout", glyph: "◎", label: "AI Scout" },
  { href: "/analytics", glyph: "◧", label: "Analytics" },
];

const SECONDARY = [{ href: "/settings", glyph: "⚙", label: "Settings" }];

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Notifications({ counts }: { counts: NavCounts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function away(event: MouseEvent) {
      if (open && ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // everything here is derived from real state, not a notifications table
  const items = [
    counts.failing > 0
      ? {
          tone: "danger" as const,
          title: `${counts.failing} board${counts.failing === 1 ? "" : "s"} failing`,
          body: "Their last fetch errored. See AI Scout for the reason.",
        }
      : null,
    counts.scoutRunning
      ? { tone: "brand" as const, title: "Scan in progress", body: counts.scoutLabel }
      : null,
    counts.queue > 0
      ? {
          tone: "brand" as const,
          title: `${counts.queue} roles waiting`,
          body: "In the queue and not yet decided.",
        }
      : null,
    counts.lastRunAt
      ? { tone: "quiet" as const, title: "Last scan", body: ago(counts.lastRunAt) }
      : null,
  ].filter(Boolean) as Array<{ tone: string; title: string; body: string }>;

  const unread = counts.failing > 0 ? counts.failing : counts.scoutRunning ? 1 : 0;

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="iconbtn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        style={{ position: "relative" }}
      >
        ◔
        {unread > 0 ? (
          <span className="badge" style={{ position: "absolute", top: -5, right: -5 }}>
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-panel">
          <header>Notifications</header>
          {items.length === 0 ? (
            <div className="item">
              <span className="dot" data-state="ok" style={{ marginTop: 5 }} />
              <div className="body">
                <b>All quiet</b>
                <span>Nothing needs you right now.</span>
              </div>
            </div>
          ) : (
            items.map((item) => (
              <div className="item" key={item.title}>
                <span
                  className="dot"
                  data-state={item.tone === "danger" ? "failed" : item.tone === "brand" ? "running" : "ok"}
                  style={{ marginTop: 5 }}
                />
                <div className="body">
                  <b>{item.title}</b>
                  <span>{item.body}</span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Dashboard", sub: "Where things stand" },
  "/jobs": { title: "Jobs", sub: "The review queue" },
  "/applications": { title: "Applications", sub: "Everything you said yes to" },
  "/scout": { title: "AI Scout", sub: "What the crawler is doing" },
  "/analytics": { title: "Analytics", sub: "Measured, not guessed" },
  "/settings": { title: "Settings", sub: "Sources, scoring and profile" },
};

export function Shell({ counts, children }: { counts: NavCounts; children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere that is not already a text field
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // a job page is not in TITLES because its path carries a fingerprint; the
  // back button and the job's own header say where you are, so the topbar
  // only has to name the section
  const head =
    TITLES[pathname] ??
    (pathname.startsWith("/jobs/") ? { title: "Job", sub: "The full posting" } : { title: "Jobscout", sub: "" });
  const progress = counts.scoutTotal > 0 ? Math.round((counts.scoutDone / counts.scoutTotal) * 100) : 0;
  const detail = pathname.startsWith("/jobs/");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <g fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
                <circle cx="12" cy="12" r="8.5" opacity="0.55" />
                <circle cx="12" cy="12" r="4" opacity="0.8" />
                <path className="sweep" d="M12 12 L12 3.5" />
              </g>
              <circle cx="12" cy="12" r="1.5" fill="#fff" />
            </svg>
          </span>
          <h1>JOB SCOUT</h1>
        </div>

        <nav className="nav">
          {NAV.map((item) => {
            const on = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const badge = item.badge ? counts[item.badge] : 0;
            return (
              <Link key={item.href} href={item.href} data-on={on}>
                <span className="glyph">{item.glyph}</span>
                {item.label}
                {badge > 0 ? <span className="count mono">{badge}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="nav-label">Account</div>
        <nav className="nav">
          {SECONDARY.map((item) => (
            <Link key={item.href} href={item.href} data-on={pathname.startsWith(item.href)}>
              <span className="glyph">{item.glyph}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="scout-block">
          <div className="head">
            <span className="dot" data-state={counts.scoutState} />
            AI Scout
          </div>
          <div className="line">{counts.scoutLabel}</div>
          {counts.scoutRunning ? (
            <>
              <div className="bar">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="line mono">
                {counts.scoutDone} / {counts.scoutTotal} boards
              </div>
            </>
          ) : (
            <div className="line mono">{ago(counts.lastRunAt)}</div>
          )}
        </div>

        <div className="avatar-row">
          <span className="avatar">JS</span>
          <span className="who">
            <b>Job seeker</b>
            <span>Backend · remote</span>
          </span>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          {detail ? (
            <button className="iconbtn" onClick={() => router.back()} aria-label="Back">
              ‹
            </button>
          ) : null}
          <h2>{head.title}</h2>
          {head.sub ? <span className="sub">{head.sub}</span> : null}

          <div className="search">
            <span className="glyph">⌕</span>
            <input
              ref={searchRef}
              className="mono"
              placeholder="Search roles and companies"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") event.currentTarget.blur();
                if (event.key === "Enter" && query.trim()) {
                  router.push(`/jobs?q=${encodeURIComponent(query.trim())}`);
                }
              }}
            />
            <kbd>/</kbd>
          </div>

          <Notifications counts={counts} />
        </div>

        {children}
      </div>
    </div>
  );
}
