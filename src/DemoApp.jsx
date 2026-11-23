import { useEffect, useMemo, useState } from "react";
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

function PosterCard({ item, onSelect }) {
  return <button className="demo-title-card" onClick={() => onSelect(item)}>
    <span className="demo-title-poster"><img src={image(item.poster, "w342")} alt="" /><span className="demo-title-action">↗</span></span>
    <strong>{item.title}</strong><small>{item.year} <span>·</span> {item.genre.split(" · ")[0]}</small>
  </button>;
}

export default function DemoApp() {
  const [active, setActive] = useState("discover");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem("streambert-demo-saved") || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem("streambert-demo-saved", JSON.stringify(saved)); } catch {} }, [saved]);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && ["k", "f"].includes(event.key.toLowerCase())) { event.preventDefault(); document.getElementById("demo-search")?.focus(); }
      if (event.key === "Escape") { setSelected(null); setSearch(""); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const all = useMemo(() => [...movies, ...series], []);
  const results = all.filter(item => item.title.toLowerCase().includes(search.trim().toLowerCase()));
  const select = item => { setSelected(item); setSearch(""); };
  const nav = (id, label, icon) => <button className={`sidebar-btn ${active === id ? "active" : ""}`} onClick={() => { setActive(id); setSearch(""); }} title={label}>{icon}<span className="sidebar-btn-label">{label}</span></button>;
  return <div className="frame-demo">
    <aside className="sidebar">
      <button className="sidebar-brand" onClick={() => setActive("discover")}><span className="sidebar-logo"><img src="./logo.svg" alt="" /></span><span className="sidebar-brand-copy"><strong>frame<span>.</span></strong><small>YOUR SCREEN, YOUR SPACE</small></span></button>
      <div className="sidebar-group-label">MENU</div>
      {nav("discover", "Discover", <HomeIcon />)}
      {nav("library", "My library", <BookmarkIcon />)}
      {nav("series", "Series", <TVIcon />)}
      <div className="sidebar-group-label sidebar-saved-label">YOUR SAVED TITLES</div>
      <div className="sidebar-saved demo-saved">{all.filter(item => saved.includes(item.id)).map(item => <button key={item.id} onClick={() => select(item)} title={item.title}><img src={image(item.poster, "w92")} alt={item.title} /></button>)}</div>
      <div className="sidebar-bottom">{nav("settings", "About preview", <SettingsIcon />)}<div className="demo-status"><i /> BROWSER PREVIEW</div></div>
    </aside>
    <main className="main">
      <header className="app-header"><div className="app-header-location"><span>YOUR SPACE</span><strong>{({discover:"Discover", library:"My library", series:"Series", settings:"About preview"})[active]}</strong></div><label className="demo-search-new"><SearchIcon /><input id="demo-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search movies & series" aria-label="Search movies and series" /><kbd>⌘ K</kbd></label></header>
      {search.trim() ? <div className="demo-page"><div className="demo-page-heading"><span>EXPLORE FRAME</span><h1>Search results</h1><p>{results.length} titles for “{search}”</p></div><div className="demo-title-grid">{results.map(item => <PosterCard key={item.id} item={item} onSelect={select} />)}</div>{!results.length && <div className="demo-empty">No matching titles in this preview.</div>}</div> : <>
      {active === "discover" && <>
        <div className="discover-intro"><div><span>THE BIG PICTURE</span><h1>Find your next favorite.</h1><p>All the stories you love, in one place.</p></div><div className="discover-intro-mark">✳ <span>YOUR PERSONAL<br />SCREENING ROOM</span></div></div>
        <section className="hero demo-new-hero"><div className="hero-bg demo-new-hero-bg" /><div className="hero-gradient" /><div className="hero-content"><div className="hero-type">IN THE SPOTLIGHT &nbsp;/&nbsp; TRENDING MOVIE</div><div className="hero-title">Dune: Part Two</div><div className="hero-meta"><span className="hero-rating">★ 8.7</span><span>2024</span><span>Science fiction · Adventure</span></div><p className="hero-overview">Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.</p><div className="hero-actions"><button className="btn btn-primary" onClick={() => select(movies[0])}><PlayIcon /> Explore title</button><button className="btn btn-secondary" onClick={() => setActive("library")}>My library ↗</button></div></div><div className="hero-index">01 <span>/</span> THE SPOTLIGHT</div></section>
        <section className="demo-collection"><div className="demo-collection-heading"><div><span>THE WEEKLY EDIT</span><h2>Trending movies</h2></div><span>CURATED FOR YOU &nbsp; ↗</span></div><div className="demo-title-grid">{movies.map(item => <PosterCard key={item.id} item={item} onSelect={select} />)}</div></section>
        <section className="demo-collection"><div className="demo-collection-heading"><div><span>ONE MORE EPISODE</span><h2>Series to get lost in</h2></div><button onClick={() => setActive("series")}>EXPLORE SERIES &nbsp; ↗</button></div><div className="demo-title-grid">{series.map(item => <PosterCard key={item.id} item={item} onSelect={select} />)}</div></section>
      </>}
      {active === "library" && <div className="demo-page"><div className="demo-page-heading"><span>YOUR COLLECTION</span><h1>My library.</h1><p>Your saved titles, all together.</p></div>{saved.length ? <div className="demo-title-grid">{all.filter(item => saved.includes(item.id)).map(item => <PosterCard key={item.id} item={item} onSelect={select} />)}</div> : <div className="demo-empty">Nothing saved yet. Discover a title and add it to your library.<br /><button className="btn btn-primary" onClick={() => setActive("discover")}>Explore titles →</button></div>}</div>}
      {active === "series" && <div className="demo-page"><div className="demo-page-heading"><span>FIND YOUR NEXT OBSESSION</span><h1>Series.</h1><p>Great stories are worth another episode.</p></div><div className="demo-title-grid">{series.map(item => <PosterCard key={item.id} item={item} onSelect={select} />)}</div></div>}
      {active === "settings" && <div className="demo-page"><div className="demo-page-heading"><span>GOOD TO KNOW</span><h1>About this preview.</h1><p>A little look at your new screening room.</p></div><div className="demo-empty"><h2>Meet Frame.</h2><p>This browser preview uses sample titles. Playback, downloads and settings are available in the desktop app, not on this page.</p><p>Saved titles in this preview stay in this browser. The desktop app saves progress and offers downloads for supported sources; it does not automatically record streams.</p></div></div>}
      </>}
      <footer className="demo-footer"><span>frame<span>.</span></span><p>YOUR SCREEN, YOUR SPACE &nbsp; / &nbsp; UI PREVIEW</p></footer>
    </main>
    {selected && <div className="demo-detail-backdrop" onClick={() => setSelected(null)}><article className="demo-detail" role="dialog" aria-modal="true" aria-label={`${selected.title} details`} onClick={e => e.stopPropagation()}><button className="demo-close" onClick={() => setSelected(null)} aria-label="Close details">×</button><img src={image(selected.poster, "w500")} alt="" /><div><span className="demo-kicker">A CLOSER LOOK</span><h2>{selected.title}</h2><p>{selected.year} · {selected.genre}</p><div className="demo-detail-rating"><StarIcon size={14} /> {selected.rating} audience rating</div><div className="demo-hero-actions"><button className="btn btn-primary" onClick={() => setSaved(value => value.includes(selected.id) ? value.filter(id => id !== selected.id) : [...value, selected.id])}>{saved.includes(selected.id) ? "✓ Saved to library" : "+ Save to library"}</button></div><p className="demo-detail-note">Preview only. Playback is available in the desktop app.</p></div></article></div>}
  </div>;
}
