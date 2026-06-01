import { useState, useEffect, useRef, useCallback } from "react";
import { fetchIptvData, getCountries, getCategories } from "../utils/iptv";

const CATEGORY_LABELS = {
  general: "General",
  news: "News",
  sports: "Sports",
  movies: "Movies",
  music: "Music",
  kids: "Kids",
  entertainment: "Entertainment",
  documentary: "Documentary",
  education: "Education",
  religious: "Religious",
  cooking: "Cooking",
  travel: "Travel",
  lifestyle: "Lifestyle",
  business: "Business",
  weather: "Weather",
  science: "Science",
  auto: "Auto",
  shop: "Shopping",
  series: "Series",
  culture: "Culture",
  outdoor: "Outdoor",
  relax: "Relax",
  animation: "Animation",
  family: "Family",
  classic: "Classic",
  comedy: "Comedy",
  public: "Public",
};

function ChannelCard({ stream, onPlay, active }) {
  return (
    <button
      className={`iptv-card${active ? " iptv-card--active" : ""}`}
      onClick={() => onPlay(stream)}
      title={stream.name}
    >
      <div className="iptv-card__logo">
        {stream.logo ? (
          <img src={stream.logo} alt={stream.channelName} loading="lazy" />
        ) : (
          <div className="iptv-card__logo-fallback">
            {stream.channelName.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="iptv-card__info">
        <span className="iptv-card__name">{stream.channelName}</span>
        {stream.quality && (
          <span className="iptv-card__quality">{stream.quality}</span>
        )}
      </div>
      {stream.label && (
        <span
          className={`iptv-card__badge${stream.label === "Geo-blocked" ? " iptv-card__badge--geo" : " iptv-card__badge--info"}`}
        >
          {stream.label === "Geo-blocked" ? "GEO" : "~24/7"}
        </span>
      )}
    </button>
  );
}

export default function LiveTVPage() {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [country, setCountry] = useState("FR");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState(null);
  const [countries, setCountries] = useState([]);
  const [categories, setCategories] = useState([]);
  const webviewRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIptvData()
      .then(({ streams: all }) => {
        if (cancelled) return;
        setStreams(all);
        setCountries(getCountries(all));
        setCategories(getCategories(all));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = streams.filter((s) => {
    if (country !== "all" && s.country !== country) return false;
    if (category !== "all" && !s.categories.includes(category)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.channelName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handlePlay = useCallback((stream) => {
    setPlaying(stream);
  }, []);

  const handleStop = useCallback(() => {
    setPlaying(null);
  }, []);

  return (
    <div className="livetv-page">
      {/* Player */}
      {playing && (
        <div className="livetv-player">
          <div className="livetv-player__header">
            <span className="livetv-player__title">
              {playing.logo && (
                <img src={playing.logo} alt="" className="livetv-player__logo" />
              )}
              {playing.name}
              {playing.quality && (
                <span className="livetv-player__quality">{playing.quality}</span>
              )}
              {playing.label && (
                <span className="iptv-card__badge iptv-card__badge--geo">
                  {playing.label}
                </span>
              )}
            </span>
            <button className="livetv-player__close" onClick={handleStop}>
              ✕
            </button>
          </div>
          <webview
            ref={webviewRef}
            src={playing.url}
            className="livetv-player__webview"
            allowpopups="false"
            partition="persist:player"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>
      )}

      {/* Filters */}
      <div className="livetv-filters">
        <input
          className="livetv-search"
          placeholder="Search channels…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="livetv-select"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="livetv-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
          ))}
        </select>
        <span className="livetv-count">
          {loading ? "Loading…" : `${filtered.length} channels`}
        </span>
      </div>

      {/* Channel grid */}
      <div className="livetv-grid">
        {loading && (
          <div className="livetv-loading">Loading channels…</div>
        )}
        {error && (
          <div className="livetv-error">Failed to load channels: {error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="livetv-empty">No channels found.</div>
        )}
        {!loading && !error && filtered.map((s) => (
          <ChannelCard
            key={s.id}
            stream={s}
            onPlay={handlePlay}
            active={playing?.id === s.id}
          />
        ))}
      </div>
    </div>
  );
}
