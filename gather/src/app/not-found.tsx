/** #144: the app's own 404, reached when an invite code names no published event or a route is unknown. */
export default function NotFound() {
  return (
    <div>
      <header className="band">
        <a className="brand" href="/">Gather</a>
      </header>
      <main className="sheet">
        <div className="wrap" style={{ gridTemplateColumns: "minmax(0, 640px)", justifyContent: "center" }}>
          <div>
            <h1 className="title" data-testid="not-found-title">Page not found</h1>
            <p className="lead">This link points to no event</p>
            <a className="btn ghost" href="/" data-testid="not-found-home">Back to Gather</a>
          </div>
        </div>
      </main>
    </div>
  );
}
