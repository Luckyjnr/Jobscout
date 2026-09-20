"use client";

import { useEffect, useRef, useState } from "react";
import type { Analytics } from "../db";

/**
 * Three charts drawn as inline SVG. No chart library: each one is a handful
 * of points turned into a path, which is less code than configuring a library
 * would be and leaves the axis colours and type under the design's control
 * rather than a theme object's.
 *
 * All three grow in when they first scroll into view, and all three skip that
 * when the viewer has asked for reduced motion — the animation is a CSS
 * transition on a single property, so "reduced" genuinely means the final
 * state is painted immediately rather than a faster version of the same move.
 */

const AXIS = "#222938";
const BLUE = "#3D8BFF";
const PURPLE = "#7C3AED";
const DIM = "#2C3446";

/** True once the element has been on screen, and immediately if motion is off. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver !== "function") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, shown] as const;
}

/** A y-axis top that is a round number at or above the data's maximum. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ------------------------------------------------------- discovered over time

export function DiscoveredOverTime({ data }: { data: Analytics["discovered"] }) {
  const [ref, shown] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <p style={{ color: "var(--slate)", margin: 0 }}>No jobs discovered yet.</p>;
  }

  const W = 620;
  const H = 200;
  const PAD = { top: 12, right: 12, bottom: 26, left: 38 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const top = niceMax(Math.max(...data.map((d) => d.discovered), 1));
  const x = (i: number) => PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const line = (key: "discovered" | "matched") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = (key: "discovered" | "matched") =>
    `${line(key)} L${x(data.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

  const ticks = [0, 0.5, 1].map((t) => Math.round(top * t));
  const active = hover === null ? null : data[hover];

  return (
    <div className="chart" ref={ref} data-shown={shown}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Jobs discovered and matched per day over the last 30 days">
        <defs>
          <linearGradient id="fill-discovered" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.26" />
            <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fill-matched" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PURPLE} stopOpacity="0.3" />
            <stop offset="100%" stopColor={PURPLE} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke={AXIS} strokeWidth="1" />
            <text x={PAD.left - 7} y={y(tick) + 3.5} textAnchor="end" className="c-label">
              {tick}
            </text>
          </g>
        ))}

        <path d={area("discovered")} fill="url(#fill-discovered)" className="c-area" />
        <path d={area("matched")} fill="url(#fill-matched)" className="c-area" />
        <path d={line("discovered")} fill="none" stroke={BLUE} strokeWidth="2" className="c-line" />
        <path d={line("matched")} fill="none" stroke={PURPLE} strokeWidth="2" className="c-line" />

        {/* every 7th day, plus the last — unless the last would collide with it */}
        {data.map((d, i) => {
          const last = data.length - 1;
          const label = i % 7 === 0 || i === last;
          if (!label) return null;
          if (i === last && last % 7 !== 0 && last - Math.floor(last / 7) * 7 < 3) return null;
          return (
            <text
              key={d.day}
              x={x(i)}
              y={H - 8}
              textAnchor={i === last ? "end" : i === 0 ? "start" : "middle"}
              className="c-label"
            >
              {shortDate(d.day)}
            </text>
          );
        })}

        {active ? (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke={AXIS}
            strokeWidth="1"
          />
        ) : null}
        {active ? (
          <>
            <circle cx={x(hover!)} cy={y(active.discovered)} r="3.5" fill={BLUE} />
            <circle cx={x(hover!)} cy={y(active.matched)} r="3.5" fill={PURPLE} />
          </>
        ) : null}

        {/* one invisible column per day, so the whole height is hoverable */}
        {data.map((d, i) => (
          <rect
            key={`hit-${d.day}`}
            x={x(i) - plotW / data.length / 2}
            y={PAD.top}
            width={plotW / data.length}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((current) => (current === i ? null : current))}
          />
        ))}
      </svg>

      <div className="c-legend">
        <span><i style={{ background: BLUE }} />Discovered</span>
        <span><i style={{ background: PURPLE }} />Matched</span>
        {active ? (
          <b className="mono">
            {shortDate(active.day)} · {active.discovered} discovered · {active.matched} matched
          </b>
        ) : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------- score distribution

export function ScoreDistribution({
  data,
  total,
}: {
  data: Analytics["scoreHistogram"];
  total: number;
}) {
  const [ref, shown] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <p style={{ color: "var(--slate)", margin: 0 }}>Nothing scored yet.</p>;
  }

  const top = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="chart hist" ref={ref} data-shown={shown}>
      <div className="hist-bars">
        {data.map((bucket, index) => (
          <div
            className="hist-col"
            key={bucket.floor}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover((c) => (c === index ? null : c))}
          >
            <i
              style={{
                height: shown ? `${Math.max((bucket.count / top) * 100, bucket.count > 0 ? 2 : 0)}%` : "0%",
                background: bucket.strong ? BLUE : DIM,
                transitionDelay: `${Math.min(index, 20) * 18}ms`,
              }}
            />
            <small>{bucket.label}</small>
            {hover === index ? (
              <span className="hist-tip mono">
                {bucket.floor} to {bucket.floor + 9} · {bucket.count.toLocaleString()}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="c-caption">
        All {total.toLocaleString()} jobs analyzed. Strong matches in bright blue.
      </p>
    </div>
  );
}

// ---------------------------------------------------- applications over time

export function ApplicationsOverTime({ data }: { data: Analytics["applicationsByWeek"] }) {
  const [ref, shown] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const top = Math.max(...data.map((d) => d.count), 1);
  const none = data.every((d) => d.count === 0);

  return (
    <div className="chart hist weeks" ref={ref} data-shown={shown}>
      <div className="hist-bars">
        {data.map((week, index) => (
          <div
            className="hist-col"
            key={week.week}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover((c) => (c === index ? null : c))}
          >
            <i
              style={{
                height: shown ? `${Math.max((week.count / top) * 100, week.count > 0 ? 3 : 0)}%` : "0%",
                background: BLUE,
                transitionDelay: `${index * 30}ms`,
              }}
            />
            <small>{week.label}</small>
            {hover === index ? (
              <span className="hist-tip mono">
                {week.count} sent
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="c-caption">
        {none
          ? "Nothing applied for yet — a week fills in when a role reaches Applied."
          : `Applications sent per week, from the date each role reached Applied.`}
      </p>
    </div>
  );
}
