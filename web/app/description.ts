/**
 * Giving shape back to a job description.
 *
 * Every adapter stores descriptions as plain text: the HTML is stripped on
 * the way in, which leaves blank-line separated blocks, headings sitting on
 * their own line, and bullets written as "- item". That is enough structure
 * to render properly without guessing.
 *
 * Nothing here invents a section. A heading is only marked as one when the
 * posting actually wrote it, and the posting's own wording is what gets
 * shown — the canonical `section` is a styling hint, not a replacement. A
 * description with no headings comes back as plain paragraphs, which is what
 * it is.
 */

export type Section =
  | "about"
  | "responsibilities"
  | "requirements"
  | "nice-to-have"
  | "benefits";

export type Block =
  | { kind: "heading"; text: string; section: Section }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/**
 * Patterns for the five sections worth styling, longest-intent first. These
 * are matched against a whole short line, so "Requirements" hits and "The
 * requirements below are flexible" does not.
 */
const HEADINGS: Array<{ section: Section; patterns: RegExp[] }> = [
  {
    // checked before "requirements" so "Preferred qualifications" and
    // "Nice to have" do not get swallowed by the harder requirements list
    section: "nice-to-have",
    patterns: [
      /^nice[\s-]to[\s-]haves?$/i,
      /^bonus points?$/i,
      /^bonus if you$/i,
      /^preferred (qualifications?|requirements?|experience)$/i,
      /^nice extras?$/i,
      /^what would be nice$/i,
    ],
  },
  {
    section: "about",
    patterns: [
      /^about (the|this) (role|job|position|opportunity)$/i,
      /^the role$/i,
      /^role (overview|summary)$/i,
      /^an overview of this role$/i,
      /^about (us|the (company|team))$/i,
      // "About Stripe", "About Vercel" — by far the commonest form in the corpus.
      // "About You" is not the company, and belongs under requirements.
      /^[Aa]bout (?!you\b)[A-Z][\w.&'-]*( [A-Z][\w.&'-]*)?$/i,
      /^who we are$/i,
      /^[Ww]hy [A-Z][\w.&'-]+$/,
      /^the opportunity$/i,
    ],
  },
  {
    section: "responsibilities",
    patterns: [
      /^(key |your |core )?responsibilit(y|ies)$/i,
      /^what you('|’)?ll (do|be doing)$/i,
      /^what you will (do|be doing)$/i,
      /^in this role,? you will$/i,
      /^the job$/i,
      /^day[\s-]to[\s-]day$/i,
    ],
  },
  {
    section: "requirements",
    patterns: [
      /^(the |minimum |basic |key |core )?requirements?$/i,
      /^(minimum |basic |required |key )?qualifications?$/i,
      /^what (we('|’)?re|we are) looking for$/i,
      /^who you are$/i,
      /^about you$/i,
      /^what you('|’)?ll bring$/i,
      /^you (should )?have$/i,
      /^skills? (and|&) experience$/i,
    ],
  },
  {
    section: "benefits",
    patterns: [
      /^benefits?( (and|&) perks?)?$/i,
      /^perks?( (and|&) benefits?)?$/i,
      /^what we offer$/i,
      /^(total )?compensation( and pay transparency)?$/i,
      // GitLab writes its benefits section this way on every posting
      /^how [\w.&'-]+ (supports?|will support)\b.{0,32}$/i,
      /^(the )?(package|compensation (and|&) benefits)$/i,
      /^why (join|work (with|for)) us$/i,
    ],
  },
];

/** The longest a line can be and still plausibly be a heading rather than prose. */
const MAX_HEADING_CHARS = 64;

const BULLET = /^\s*([-–—*•·]|\d+[.)])\s+/;

function asHeading(line: string): Section | null {
  const text = line.trim().replace(/[:：]\s*$/, "");
  if (text.length === 0 || text.length > MAX_HEADING_CHARS) return null;
  // a heading is a label, not a sentence
  if (/[.!?]$/.test(text)) return null;

  for (const entry of HEADINGS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.section;
  }
  return null;
}

/**
 * Split a description into blocks. Consecutive bullets merge into one list,
 * including when the source left a blank line between each of them, which
 * several boards do.
 */
export function describe(description: string): Block[] {
  const text = (description ?? "").replace(/\r\n?/g, "\n").trim();
  if (text === "") return [];

  const chunks = text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const blocks: Block[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);

    // a chunk that is one short line and reads like a label
    if (lines.length === 1) {
      const section = asHeading(lines[0]!);
      if (section) {
        blocks.push({ kind: "heading", text: lines[0]!.replace(/[:：]\s*$/, ""), section });
        continue;
      }
    }

    // a chunk whose lines are all bullets
    if (lines.every((line) => BULLET.test(line))) {
      const items = lines.map((line) => line.replace(BULLET, "").trim()).filter(Boolean);
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "list") previous.items.push(...items);
      else if (items.length > 0) blocks.push({ kind: "list", items });
      continue;
    }

    // a chunk that opens with prose and then lists, which happens when a board
    // keeps the intro and its bullets in one paragraph
    const firstBullet = lines.findIndex((line) => BULLET.test(line));
    if (firstBullet > 0) {
      const lead = lines.slice(0, firstBullet).join(" ");
      const heading = lines.length > firstBullet ? asHeading(lead) : null;
      if (heading) blocks.push({ kind: "heading", text: lead.replace(/[:：]\s*$/, ""), section: heading });
      else blocks.push({ kind: "paragraph", text: lead });

      const items = lines
        .slice(firstBullet)
        .filter((line) => BULLET.test(line))
        .map((line) => line.replace(BULLET, "").trim())
        .filter(Boolean);
      if (items.length > 0) blocks.push({ kind: "list", items });
      continue;
    }

    blocks.push({ kind: "paragraph", text: lines.join(" ") });
  }

  return blocks;
}

/** Which of the five sections this posting actually wrote, in order. */
export function sectionsFound(blocks: Block[]): Section[] {
  const seen: Section[] = [];
  for (const block of blocks) {
    if (block.kind === "heading" && !seen.includes(block.section)) seen.push(block.section);
  }
  return seen;
}
