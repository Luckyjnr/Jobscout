import { applications } from "../db";
import { Board } from "./board";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const rows = await applications();

  if (rows.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <span className="glyph">▦</span>
          <b>No applications yet</b>
          <p>
            Anything you mark interested in the queue lands here, and you move it along the board as
            it progresses.
          </p>
          <a className="btn primary" href="/jobs">
            Go to the queue
          </a>
        </div>
      </div>
    );
  }

  return <Board rows={rows} />;
}
