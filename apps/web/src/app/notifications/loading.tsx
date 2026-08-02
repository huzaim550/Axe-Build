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

      <div className="card stack" style={{ maxWidth: 700 }}>
        <div className="form-grid">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <span className="skeleton" style={{ width: 54, height: 10 }} />
              <span className="skeleton" style={{ height: 36, marginTop: 8, borderRadius: 7 }} />
            </div>
          ))}
        </div>
        <div>
          <span className="skeleton" style={{ width: 40, height: 10 }} />
          <span className="skeleton" style={{ height: 36, marginTop: 8, borderRadius: 7 }} />
        </div>
        <div>
          <span className="skeleton" style={{ width: 64, height: 10 }} />
          <span className="skeleton" style={{ height: 96, marginTop: 8, borderRadius: 7 }} />
        </div>
        <span className="skeleton" style={{ width: 96, height: 34, borderRadius: 7 }} />
      </div>

      <div className="section-head">
        <h2>Sent</h2>
      </div>
      <div className="card stack">
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ opacity: 1 - i * 0.25 }}>
            <span className="skeleton skeleton-line" style={{ width: "38%" }} />
            <span className="skeleton skeleton-line" style={{ width: "72%" }} />
          </div>
        ))}
      </div>
    </main>
  );
}
