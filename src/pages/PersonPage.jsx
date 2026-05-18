import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchPerson,
  fetchPersonCombinedCredits,
  imgUrl,
} from "../utils/api";
import {
  parseCombinedCredits,
  sortCredits,
  computeKnownFor,
  truncateBio,
} from "../utils/personCredits";
import {
  BackIcon,
  StarIcon,
} from "../components/Icons";
import MediaCard from "../components/MediaCard";

export default function PersonPage({ item, apiKey, onSelect, onBack }) {
  const [person, setPerson] = useState(null);
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creditsTab, setCreditsTab] = useState("movie");
  const [sort, setSort] = useState("popularity");
  const [bioExpanded, setBioExpanded] = useState(false);

  // Fetch person data
  useEffect(() => {
    if (!item?.id || !apiKey) return;
    let mounted = true;
    setLoading(true);
    setPerson(null);
    setCredits(null);

    Promise.all([
      fetchPerson(item.id, apiKey),
      fetchPersonCombinedCredits(item.id, apiKey),
    ])
      .then(([personData, creditsData]) => {
        if (!mounted) return;
        setPerson(personData);
        setCredits(creditsData);
      })
      .catch(() => {
        if (!mounted) return;
        setPerson(item);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [item?.id, apiKey]);

  // Parse credits
  const { movies, tv } = useMemo(
    () => parseCombinedCredits(credits),
    [credits],
  );

  // Known for
  const knownFor = useMemo(
    () => computeKnownFor(movies, tv, 8),
    [movies, tv],
  );

  // Sorted filmography for current tab
  const sortedCredits = useMemo(() => {
    const source = creditsTab === "movie" ? movies : tv;
    return sortCredits(source, sort);
  }, [creditsTab, movies, tv, sort]);

  // Biography
  const bio = useMemo(() => {
    if (!person?.biography) return "";
    if (bioExpanded) return person.biography;
    return truncateBio(person.biography, 4);
  }, [person?.biography, bioExpanded]);

  const hasLongBio = person?.biography && person.biography.length > bio.length;

  // Lifespan
  const lifespan = useMemo(
    () => {
      if (!person) return "";
      const parts = [];
      if (person.birthday) {
        const year = parseInt(person.birthday.slice(0, 4), 10);
        const now = new Date().getFullYear();
        if (person.deathday) {
          const dYear = parseInt(person.deathday.slice(0, 4), 10);
          parts.push(`Died ${person.deathday} (age ${dYear - year})`);
        } else {
          parts.push(`Born ${person.birthday} (age ${now - year})`);
        }
      }
      if (person.place_of_birth) {
        parts.push(person.place_of_birth);
      }
      return parts.join(" · ");
    },
    [person],
  );

  // Stats
  const stats = useMemo(() => {
    if (!person) return "";
    const parts = [];
    if (person.popularity) {
      parts.push(`Popularity ${Math.round(person.popularity)}`);
    }
    const totalCredits = (movies?.length || 0) + (tv?.length || 0);
    if (totalCredits > 0) {
      parts.push(`${totalCredits} credits`);
    }
    return parts.join(" · ");
  }, [person, movies, tv]);

  // Handlers
  const handleKnownForClick = useCallback(
    (kfItem) => {
      onSelect({
        id: kfItem.id,
        title: kfItem.title,
        name: kfItem.title,
        poster_path: kfItem.poster_path,
        media_type: kfItem.media_type,
        vote_average: kfItem.vote_average,
        release_date: kfItem.date,
        first_air_date: kfItem.date,
      });
    },
    [onSelect],
  );

  const handleFilmographyClick = useCallback(
    (fgItem) => {
      onSelect({
        id: fgItem.id,
        title: fgItem.title,
        name: fgItem.title,
        poster_path: fgItem.poster_path,
        media_type: fgItem.media_type,
        vote_average: fgItem.vote_average,
        release_date: fgItem.date,
        first_air_date: fgItem.date,
      });
    },
    [onSelect],
  );

  const handlePersonClick = useCallback(
    (pItem) => {
      onSelect({
        id: pItem.id,
        name: pItem.name,
        profile_path: pItem.profile_path,
        media_type: "person",
      });
    },
    [onSelect],
  );

  // Loading state
  if (loading) {
    return (
      <div>
        <div className="detail-hero" style={{ minHeight: 420 }}>
          <div className="person-hero-loading" />
        </div>
      </div>
    );
  }

  const displayName = person?.name || item?.name || "Unknown";
  const profilePath = person?.profile_path || item?.profile_path;
  const department = person?.known_for_department || "";

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="detail-hero person-detail-hero">
        {/* Use profile image as backdrop (blurred) */}
        {profilePath && (
          <div
            className="detail-bg person-detail-bg"
            style={{
              backgroundImage: `url(${imgUrl(profilePath, "original")})`,
              filter: "blur(40px) brightness(0.3)",
              transform: "scale(1.2)",
            }}
          />
        )}
        <div className="detail-gradient" />
        <div className="detail-content person-detail-content">
          <div className="detail-poster person-profile-pic">
            {profilePath ? (
              <img
                src={imgUrl(profilePath, "h632")}
                alt={displayName}
              />
            ) : (
              <div className="person-profile-fallback">
                {displayName
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()}
              </div>
            )}
          </div>
          <div className="detail-info person-detail-info">
            <div className="detail-type person-detail-type">
              {department || "Person"}
            </div>
            <div className="detail-title person-detail-title">{displayName}</div>
            {stats && (
              <div className="person-detail-stats">{stats}</div>
            )}
            {lifespan && (
              <div className="detail-meta person-detail-meta">
                <span>{lifespan}</span>
              </div>
            )}
            {bio && (
              <div className="person-detail-bio">
                <p className="detail-overview">{bio}</p>
                {hasLongBio && (
                  <button
                    className="person-bio-toggle"
                    onClick={() => setBioExpanded((v) => !v)}
                  >
                    {bioExpanded ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
            )}
            <div className="detail-actions person-detail-actions">
              <button className="btn btn-ghost" onClick={onBack}>
                <BackIcon /> Back
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Known For ────────────────────────────────────────────────── */}
      {knownFor.length > 0 && (
        <div className="section">
          <div className="section-title">Known For</div>
          <div className="scroll-row">
            {knownFor.map((kf) => (
              <div
                key={`${kf.media_type}_${kf.id}`}
                className="card person-knownfor-card"
                onClick={() => handleKnownForClick(kf)}
                style={{ width: 150, flexShrink: 0 }}
              >
                <div className="card-poster">
                  {kf.poster_path ? (
                    <img
                      src={imgUrl(kf.poster_path, "w342")}
                      alt={kf.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="no-poster">
                      <span style={{ fontSize: 10, color: "var(--text3)" }}>
                        No Image
                      </span>
                    </div>
                  )}
                </div>
                <div className="card-info">
                  <div className="card-title">{kf.title}</div>
                  <div className="card-year">
                    {kf.year || "—"} · {kf.media_type === "tv" ? "Series" : "Movie"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filmography ──────────────────────────────────────────────── */}
      {(movies.length > 0 || tv.length > 0) && (
        <div className="section">
          <div className="section-title person-filmography-header">
            <div className="person-filmography-tabs">
              {movies.length > 0 && (
                <button
                  className={`person-filmography-tab ${creditsTab === "movie" ? "active" : ""}`}
                  onClick={() => setCreditsTab("movie")}
                >
                  Movies ({movies.length})
                </button>
              )}
              {tv.length > 0 && (
                <button
                  className={`person-filmography-tab ${creditsTab === "tv" ? "active" : ""}`}
                  onClick={() => setCreditsTab("tv")}
                >
                  TV Shows ({tv.length})
                </button>
              )}
            </div>
            <div className="person-filmography-sort">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="person-filmography-select"
              >
                <option value="popularity">Popularity</option>
                <option value="year">Year</option>
                <option value="rating">Rating</option>
                <option value="alpha">A-Z</option>
              </select>
            </div>
          </div>

          <div className="person-filmography-table">
            {sortedCredits.map((entry) => (
              <div
                key={`${entry.media_type}_${entry.id}`}
                className="person-filmography-row"
                onClick={() => handleFilmographyClick(entry)}
              >
                <div className="person-filmography-year">
                  {entry.year || "—"}
                </div>
                <div className="person-filmography-poster">
                  {entry.poster_path ? (
                    <img
                      src={imgUrl(entry.poster_path, "w92")}
                      alt={entry.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="person-filmography-no-poster" />
                  )}
                </div>
                <div className="person-filmography-info">
                  <div className="person-filmography-title">{entry.title}</div>
                  {entry.character && (
                    <div className="person-filmography-character">
                      as {entry.character}
                    </div>
                  )}
                </div>
                {entry.vote_average > 0 && (
                  <div className="person-filmography-rating">
                    <StarIcon size={12} />
                    {entry.vote_average.toFixed(1)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!loading && movies.length === 0 && tv.length === 0 && (
        <div className="section">
          <div className="section-title">Filmography</div>
          <div
            style={{
              padding: "32px 0",
              color: "var(--text3)",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            No credits found for this person.
          </div>
        </div>
      )}
    </div>
  );
}