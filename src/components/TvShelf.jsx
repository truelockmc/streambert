export default function TvShelf({ title, children }) {
  return (
    <section className="tv-shelf">
      {title ? <h2 className="tv-shelf-title">{title}</h2> : null}
      <div className="tv-shelf-row">{children}</div>
    </section>
  );
}
