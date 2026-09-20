import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <div className="empty">
        <span className="glyph">◌</span>
        <b>Not here</b>
        <p>That role may have been closed by its board, or the link is wrong.</p>
        <Link className="btn primary" href="/jobs">
          Back to the queue
        </Link>
      </div>
    </div>
  );
}
