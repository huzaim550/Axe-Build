/** Skeleton for one project. Same blocks, same order, so nothing jumps. */
export default function Loading() {
  return (
    <main className="container">
      <span className="back-link">← All projects</span>

      <div className="page-head">
        <div>
          <span className="skeleton" style={{ width: 200, height: 20 }} />
          <span className="skeleton" style={{ width: 120, height: 11, marginTop: 10 }} />
        </div>
        <span className="live is-busy">
          <span className="spinner" />
          loading
        </span>
      </div>

      <div className="metrics">
        {[92, 128, 104, 116].map((width, i) => (
          <span className="skeleton" key={i} style={{ width, height: 14 }} />
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 22 }}>
        <h2>Live</h2>
      </div>
      <div className="card">
        <div className="meta-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <span className="skeleton" style={{ width: 54, height: 9 }} />
              <span className="skeleton" style={{ width: 96, height: 13, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="section-head">
        <h2>Builds</h2>
      </div>

      <div className="list">
        {[0, 1, 2, 3, 4].map((row) => (
          <div className="list-row" key={row} style={{ opacity: 1 - row * 0.16 }}>
            <div className="row-body">
              <span className="skeleton" style={{ width: 160, height: 14 }} />
              <span className="skeleton" style={{ width: "62%", height: 11, marginTop: 9 }} />
            </div>
            <div className="row-actions">
              <span className="skeleton" style={{ width: 52, height: 24, borderRadius: 6 }} />
              <span className="skeleton" style={{ width: 52, height: 24, borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
