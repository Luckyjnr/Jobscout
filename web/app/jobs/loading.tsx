export default function Loading() {
  return (
    <div className="page">
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((n) => (
          <div className="skeleton stat" key={n} />
        ))}
      </div>
      <div className="grid cols-2">
        {[0, 1].map((n) => (
          <div className="panel" key={n}>
            <div className="skeleton line" style={{ width: "40%" }} />
            <div className="skeleton line" />
            <div className="skeleton line" style={{ width: "80%" }} />
            <div className="skeleton line" style={{ width: "60%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
