/**
 * Shown while the builds page is being rendered on the server.
 *
 * Deliberately the same shape as the real page — a metrics line and a list of
 * rows — so the layout does not jump when the data lands. A centred spinner
 * would be honest too, but this keeps the page from flashing empty.
 */
export default function Loading() {
  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Builds</h1>
          <p>Android APKs, AABs and OTA bundles, built on this machine.</p>
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

      <div className="section-head">
        <h2>Recent</h2>
      </div>

      <div className="list">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div className="list-row" key={row} style={{ opacity: 1 - row * 0.13 }}>
            <div className="row-body">
              <span className="skeleton" style={{ width: 190, height: 14 }} />
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
