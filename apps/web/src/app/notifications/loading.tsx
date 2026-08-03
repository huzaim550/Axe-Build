/** Skeleton for the notifications page: the composer, then the sent list. */
export default function Loading() {
  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Messages installed apps fetch and show in their own inbox.</p>
        </div>
        <span className="live is-busy">
          <span className="spinner" />
          loading
        </span>
      </div>

      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Compose</h2>
      </div>
      <div className="card stack" style={{ maxWidth: 700 }}>
        <div className="form-grid">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <span className="skeleton" style={{ width: 54, height: 10 }} />
              <span className="skeleton" style={{ height: 34, marginTop: 8, borderRadius: 6 }} />
            </div>
          ))}
        </div>
        <div>
          <span className="skeleton" style={{ width: 40, height: 10 }} />
          <span className="skeleton" style={{ height: 34, marginTop: 8, borderRadius: 6 }} />
        </div>
        <div>
          <span className="skeleton" style={{ width: 64, height: 10 }} />
          <span className="skeleton" style={{ height: 96, marginTop: 8, borderRadius: 6 }} />
        </div>
        <span className="skeleton" style={{ width: 92, height: 32, borderRadius: 6 }} />
      </div>

      <div className="section-head">
        <h2>Sent</h2>
      </div>
      <div className="list">
        {[0, 1, 2].map((i) => (
          <div className="list-row" key={i} style={{ opacity: 1 - i * 0.22 }}>
            <div className="row-body">
              <span className="skeleton" style={{ width: "38%", height: 14 }} />
              <span className="skeleton" style={{ width: "72%", height: 11, marginTop: 9 }} />
              <span className="skeleton" style={{ width: "45%", height: 10, marginTop: 9 }} />
            </div>
            <div className="row-actions">
              <span className="skeleton" style={{ width: 66, height: 24, borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
