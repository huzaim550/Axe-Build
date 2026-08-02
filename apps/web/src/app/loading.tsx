/**
 * Shown while the builds page is being rendered on the server.
 *
 * Deliberately the same shape as the real page — four stat tiles and a table —
 * so the layout does not jump when the data lands. A centred spinner would be
 * honest too, but this keeps the page from flashing empty.
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

      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div className="stat" key={i}>
            <span className="skeleton" style={{ width: 64, height: 10 }} />
            <span className="skeleton" style={{ width: 88, height: 24, marginTop: 10 }} />
            <span className="skeleton" style={{ width: 110, height: 10, marginTop: 8 }} />
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>Recent</h2>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Type</th>
              <th>Version</th>
              <th>Took</th>
              <th>Size</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <tr key={row}>
                {[150, 80, 90, 70, 50, 60, 80, 110].map((width, cell) => (
                  <td key={cell}>
                    <span className="skeleton" style={{ width, opacity: 1 - row * 0.13 }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
