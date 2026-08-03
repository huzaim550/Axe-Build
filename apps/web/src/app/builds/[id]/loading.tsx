/** Skeleton for one build while the server renders it. Same blocks, same order. */
export default function Loading() {
  return (
    <main className="container">
      <span className="back-link">← All builds</span>

      <div className="page-head">
        <div>
          <span className="skeleton" style={{ width: 220, height: 20 }} />
          <span className="skeleton" style={{ width: 160, height: 11, marginTop: 10 }} />
        </div>
        <span className="live is-busy">
          <span className="spinner" />
          loading
        </span>
      </div>

      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Overview</h2>
      </div>
      <div className="card">
        <div className="meta-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i}>
              <span className="skeleton" style={{ width: 60, height: 9 }} />
              <span className="skeleton" style={{ width: 100, height: 13, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="section-head">
        <h2>Console</h2>
      </div>
      <div className="card">
        <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: "nowrap" }}>
          <span className="skeleton" style={{ width: 82, height: 20, borderRadius: 999 }} />
          <div className="progress">
            <div className="progress-fill is-running" style={{ width: "12%" }} />
          </div>
          <span className="progress-pct faint">—</span>
        </div>
        <pre className="log" style={{ minHeight: 180 }}>
          <span className="loading-row">
            <span className="spinner" />
            Loading build…
          </span>
        </pre>
      </div>
    </main>
  );
}
