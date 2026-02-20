import { useState, useEffect, useRef, useCallback } from "react";
import { imgUrl } from "../utils/api";
import {
  PlayIcon,
  FilmIcon,
  TVIcon,
  WatchedIcon,
  RatingShieldIcon,
  RatingLockIcon,
} from "./Icons";

export default function MediaCard({
  item,
  onClick,
  progress,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  ageRating,
  restricted,
}) {
  const title = item.title || item.name;
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);
  const isTV = item.media_type === "tv";

  // Build watched key – for TV cards from Continue Watching we get season/episode
  const watchedKey = isTV
    ? item.season != null && item.episode != null
      ? `tv_${item.id}_s${item.season}e${item.episode}`
      : `tv_${item.id}`
    : `movie_${item.id}`;

  const isWatched = !!watched?.[watchedKey];

  // Context menu state
  const [menu, setMenu] = useState(null); // { x, y }
  const menuRef = useRef(null);

  // For TV series cards without a specific episode, watched marking is disabled
  const canMarkWatched = !isTV || (item.season != null && item.episode != null);

  const openMenu = useCallback(
    (e) => {
      if (!canMarkWatched) return; // no context menu for whole series
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [canMarkWatched],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const handleMarkWatched = (e) => {
    e.stopPropagation();
    onMarkWatched?.(watchedKey);
    setMenu(null);
  };
  const handleMarkUnwatched = (e) => {
    e.stopPropagation();
    onMarkUnwatched?.(watchedKey);
    setMenu(null);
  };

  return (
    <>
      <div
        className={`card${isWatched ? " ep-watched" : ""}`}
        onClick={onClick}
        onContextMenu={openMenu}
      >
        <div className="card-poster">
          {item.poster_path ? (
            <img
              src={imgUrl(item.poster_path, "w342")}
              alt={title}
              loading="lazy"
            />
          ) : (
            <div className="no-poster">
              {isTV ? <TVIcon /> : <FilmIcon />}
              <span style={{ fontSize: 10, color: "var(--text3)" }}>
                No Image
              </span>
            </div>
          )}
          {ageRating && (
            <div
              className={`card-age-badge${restricted ? " card-age-badge--restricted" : ""}`}
            >
              {restricted ? (
                <RatingLockIcon size={9} />
              ) : (
                <RatingShieldIcon size={9} />
              )}
              {ageRating}
            </div>
          )}

          <div className="card-overlay">
            <div className="card-play">
              <PlayIcon />
            </div>
          </div>
          {progress > 0 && !isWatched && (
            <div className="card-progress">
              <div
                className="card-progress-fill"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
          {isWatched && (
            <div className="card-watched-badge">
              <WatchedIcon size={26} />
            </div>
          )}
        </div>
        <div className="card-info">
          <div className="card-title" title={title}>
            {title}
          </div>
          <div className="card-year">
            {year} · {isTV ? "Series" : "Movie"}
          </div>
        </div>
        <span className="card-badge">{isTV ? "TV" : "HD"}</span>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {isWatched ? (
            <button className="context-menu-item" onClick={handleMarkUnwatched}>
              ↩ Mark as Unwatched
            </button>
          ) : (
            <button className="context-menu-item" onClick={handleMarkWatched}>
              ✓ Mark as Watched
            </button>
          )}
        </div>
      )}
    </>
  );
}
