import { useMemo, useState } from "react";
import {
  BookmarkIcon,
  HomeIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  TVIcon,
} from "./components/Icons";

const image = (path, size = "w780") =>
  `https://image.tmdb.org/t/p/${size}${path}`;

const movies = [
  {
    id: 693134,
    title: "Dune: Part Two",
    year: "2024",
    genre: "Sci-fi · Adventure",
    rating: "8.7",
    poster: "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
  },
  {
    id: 823464,
    title: "Godzilla x Kong",
    year: "2024",
    genre: "Action · Sci-fi",
    rating: "7.1",
    poster: "/z1p34vh7dEOnLDmyCrlUVLuoDzd.jpg",
  },
  {
    id: 872585,
    title: "Oppenheimer",
    year: "2023",
    genre: "Drama · History",
    rating: "8.1",
    poster: "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
  },
  {
    id: 792307,
    title: "Poor Things",
    year: "2023",
    genre: "Comedy · Romance",
    rating: "7.7",
    poster: "/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg",
  },
  {
    id: 916224,
    title: "Challengers",
    year: "2024",
    genre: "Drama · Romance",
    rating: "7.2",
    poster: "/H6vke7zGiuLsz4v4RPeReb9rsv.jpg",
  },
];

const series = [
  {
    id: 1399,
    title: "House of the Dragon",
    year: "2024",
    genre: "Drama · Fantasy",
    rating: "8.4",
    poster: "/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg",
  },
  {
    id: 94605,
    title: "Arcane",
    year: "2024",
    genre: "Animation · Action",
    rating: "8.8",
    poster: "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg",
  },
  {
    id: 94997,
    title: "House of the Dragon",
    year: "2022",
    genre: "Drama · Fantasy",
    rating: "8.4",
    poster: "/z2yahl2uefxDla0eaRKeK7J3V6m.jpg",
  },
  {
    id: 119051,
    title: "Wednesday",
    year: "2022",
    genre: "Mystery · Comedy",
    rating: "8.5",
    poster: "/9PFonBhy4cQy7Jz20NpMygczOkv.jpg",
  },
  {
    id: 1396,
    title: "Breaking Bad",
    year: "2013",
    genre: "Drama · Crime",
    rating: "9.5",
    poster: "/ztkUQFLlC19CCMYHW9o1zWhJRN2.jpg",
  },
];

function PosterCard({ item, progress, onSelect }) {
  return (
    <button className="demo-card" onClick={() => onSelect(item)} type="button">
      <span className="demo-card-poster">
        <img src={image(item.poster, "w342")} alt="" />
        <span className="demo-card-sheen" />
        <span className="demo-card-play">
          <PlayIcon />
        </span>
        <span className="demo-card-rating">
          <StarIcon size={12} /> {item.rating}
        </span>
        {progress && (
          <span className="demo-progress">
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
      <span className="demo-card-title">{item.title}</span>
      <span className="demo-card-meta">
        {item.year} <i /> {item.genre.split(" · ")[0]}
      </span>
    </button>
  );
}

function DemoIconButton({ active, children, label, onClick }) {
  return (
    <button
      className={`demo-nav-button${active ? " is-active" : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export default function DemoApp() {
  const [active, setActive] = useState("home");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [liked, setLiked] = useState(false);

  const results = useMemo(() => {
    const all = [...movies, ...series];
    if (!search.trim()) return [];
    return all.filter((item) =>
      item.title.toLowerCase().includes(search.toLowerCase()),
    );
  }, [search]);

  const select = (item) => {
    setSelected(item);
    setLiked(false);
  };

  return (
    <div className="demo-app">
      <aside className="demo-sidebar">
        <div className="demo-brand">
          <img src="./logo.svg" alt="Streambert" />
          <span>STREAMBERT</span>
        </div>
        <nav className="demo-nav">
          <DemoIconButton active={active === "home"} label="Discover" onClick={() => setActive("home")}>
            <HomeIcon />
          </DemoIconButton>
          <DemoIconButton active={active === "library"} label="My library" onClick={() => setActive("library")}>
            <BookmarkIcon />
          </DemoIconButton>
          <DemoIconButton active={active === "series"} label="Series" onClick={() => setActive("series")}>
            <TVIcon />
          </DemoIconButton>
        </nav>
        <div className="demo-sidebar-bottom">
          <span className="demo-sync"><i /> Synced</span>
          <DemoIconButton active={active === "settings"} label="Settings" onClick={() => setActive("settings")}>
            <SettingsIcon />
          </DemoIconButton>
        </div>
      </aside>

      <main className="demo-main">
        <header className="demo-header">
          <div className="demo-breadcrumb"><span>Streambert</span><b>/</b> {active === "home" ? "Discover" : active}</div>
          <div className="demo-header-actions">
            <label className="demo-search">
              <SearchIcon />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search movies, series..."
              />
              <kbd>⌘ K</kbd>
            </label>
            <button className="demo-avatar" type="button">AL</button>
          </div>
        </header>

        <div className="demo-content">
          <section className="demo-hero">
            <div className="demo-hero-art" />
            <div className="demo-hero-copy">
              <span className="demo-eyebrow"><i /> Featured this week</span>
              <h1>Stories worth<br /><em>staying up for.</em></h1>
              <p>Find your next favorite movie or series. Curated picks, crisp playback, and your library in one calm place.</p>
              <div className="demo-hero-actions">
                <button className="demo-primary" onClick={() => select(movies[0])} type="button"><PlayIcon /> Start watching</button>
                <button className="demo-secondary" onClick={() => setActive("library")} type="button">Explore library <span>↗</span></button>
              </div>
            </div>
            <div className="demo-hero-note"><span>01</span><i /> 03</div>
          </section>

          <section className="demo-section">
            <div className="demo-section-heading"><div><span className="demo-kicker">Your queue</span><h2>Continue watching</h2></div><button type="button">View all <span>→</span></button></div>
            <div className="demo-row">
              {movies.slice(0, 4).map((item, index) => <PosterCard key={item.id} item={item} progress={[68, 42, 19, 84][index]} onSelect={select} />)}
            </div>
          </section>

          <section className="demo-section">
            <div className="demo-section-heading"><div><span className="demo-kicker">Popular right now</span><h2>Trending movies</h2></div><button type="button">See all <span>→</span></button></div>
            <div className="demo-row">{movies.map((item) => <PosterCard key={item.id} item={item} onSelect={select} />)}</div>
          </section>

          <section className="demo-section demo-last">
            <div className="demo-section-heading"><div><span className="demo-kicker">Keep exploring</span><h2>Top series</h2></div><button type="button">See all <span>→</span></button></div>
            <div className="demo-row">{series.slice(0, 4).map((item) => <PosterCard key={item.id} item={item} onSelect={select} />)}</div>
          </section>
        </div>
      </main>

      {search && (
        <div className="demo-search-results">
          <span className="demo-kicker">Search results</span>
          {results.length ? results.map((item) => <button key={`${item.id}-${item.title}`} onClick={() => select(item)} type="button"><img src={image(item.poster, "w92")} alt="" /><span>{item.title}<small>{item.year} · {item.genre}</small></span><b>→</b></button>) : <p>No titles found</p>}
        </div>
      )}

      {selected && (
        <div className="demo-detail-backdrop" onClick={() => setSelected(null)}>
          <article className="demo-detail" onClick={(event) => event.stopPropagation()}>
            <button className="demo-close" onClick={() => setSelected(null)} type="button">×</button>
            <img src={image(selected.poster, "w500")} alt="" />
            <div><span className="demo-kicker">Now selected</span><h2>{selected.title}</h2><p>{selected.year} · {selected.genre}</p><div className="demo-detail-rating"><StarIcon size={14} /> {selected.rating} audience rating</div><div className="demo-hero-actions"><button className="demo-primary" type="button"><PlayIcon /> Play title</button><button className={`demo-secondary${liked ? " is-liked" : ""}`} onClick={() => setLiked((value) => !value)} type="button">{liked ? "Saved to library" : "Save to library"}</button></div></div>
          </article>
        </div>
      )}
    </div>
  );
}
