import { readFileSync } from "node:fs";

/**
 * The name to greet, and the time of day to greet at.
 *
 * There is no user table in this app and profile.md does not have to state a
 * name — the current one opens "# Who I am" and never says who. So the name is
 * looked for, and left out when it is not there: "Good morning." rather than a
 * name invented to fill the slot.
 *
 * Set it either by adding a "Name: ..." line to profile.md or by setting
 * JOBSCOUT_NAME in the environment.
 */
export function readName(): string | null {
  const fromEnv = process.env["JOBSCOUT_NAME"]?.trim();
  if (fromEnv) return fromEnv;

  try {
    const profile = readFileSync(new URL("../../profile.md", import.meta.url), "utf8");
    const declared = profile.match(/^\s*(?:\*\*)?name(?:\*\*)?\s*[:—-]\s*(.+)$/im);
    if (declared) {
      const name = declared[1]!.trim().replace(/[.*_]+$/, "").trim();
      if (name.length > 0 && name.length <= 40) return name;
    }
    // "# I am Ada" / "# I'm Ada"
    const heading = profile.match(/^#\s*(?:i\s*(?:'|’)?m|i am)\s+(.+)$/im);
    if (heading) return heading[1]!.trim();
  } catch {
    // no profile.md is normal; the greeting simply has no name
  }
  return null;
}

export function timeOfDay(now = new Date()): "morning" | "afternoon" | "evening" {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function greeting(name: string | null, now = new Date()): string {
  return name ? `Good ${timeOfDay(now)}, ${name}.` : `Good ${timeOfDay(now)}.`;
}
