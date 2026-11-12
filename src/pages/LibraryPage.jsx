import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MediaCard from "../components/MediaCard";
import { imgUrl } from "../utils/api";
import { EyeIcon, WatchedIcon } from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { storage, STORAGE_KEYS } from "../utils/storage";
import { isTvMode } from "../utils/tvMode";
import { setGamepadFocus } from "../utils/gamepadSpatialNav";

function progressKey(item) {
  return item.media_type === "movie"
    ? `movie_${item.id}`
    : `tv_${item.id}_s${item.season}e${item.episode}`;
}

function formatWhen(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function episodeLabel(item) {
  if (item.media_type !== "tv" || item.season == null || item.episode == null)
    return "";
  const code = `S${item.season}E${item.episode}`;
  return item.episodeName ? `${code} · ${item.episodeName}` : code;
}

function buildHistoryGroups(history) {
  const shows = new Map();
  const groups = [];
  for (const item of history) {
    if (item.media_type !== "tv" || item.season == null || item.episode == null) {
      groups.push({
        kind: "movie",
        key: `movie_${item.id}`,
        item,
        latestAt: item.watchedAt || 0,
      });
      continue;
    }
    const key = `tv_${item.id}`;
    let group = shows.get(key);
    if (!group) {
      group = {
        kind: "series",
        key,
        id: item.id,
        title: item.title,
        poster_path: item.poster_path,
        episodes: [],
        latestAt: 0,
      };
      shows.set(key, group);
      groups.push(group);
    }
    group.episodes.push(item);
    if ((item.watchedAt || 0) >= group.latestAt) {
      group.latestAt = item.watchedAt || 0;
      if (item.poster_path) group.poster_path = item.poster_path;
      if (item.title) group.title = item.title;
    }
  }
  for (const group of groups) {
    if (group.kind !== "series") continue;
    group.episodes.sort(
      (a, b) => a.season - b.season || a.episode - b.episode,
    );
  }
  groups.sort((a, b) => b.latestAt - a.latestAt);
  return groups;
}

export default function LibraryPage({
  history,
  inProgress,
  saved,
  progress,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  onRemoveHistory,
}) {
  const allItems = useMemo(
    () => [...inProgress, ...saved],
    [inProgress, saved],
  );
  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const [sort, setSort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  useEffect(() => {
    const handler = (e) => setSort(e.detail);
    window.addEventListener("streambert:library-sort-changed", handler);
    return () =>
      window.removeEventListener("streambert:library-sort-changed", handler);
  }, []);

  const sortLabels = {
    manual: "Custom order",
    title: "A-Z",
    rating: "Top rated",
    year: "Newest first",
  };

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) => isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  const groups = useMemo(() => buildHistoryGroups(history), [history]);
  const [openKey, setOpenKey] = useState(null);
  const openGroup = groups.find((group) => group.key === openKey) || null;
  const openKeyRef = useRef(null);
  const [resumeKey, setResumeKey] = useState(null);

  useEffect(() => {
    if (openKey && !groups.some((group) => group.key === openKey)) {
      setOpenKey(null);
    }
  }, [groups, openKey]);

  useEffect(() => {
    const onBack = (event) => {
      if (!openKey) return;
      event.preventDefault();
      setOpenKey(null);
    };
    window.addEventListener("streambert:tv-back", onBack);
    return () => window.removeEventListener("streambert:tv-back", onBack);
  }, [openKey]);

  useEffect(() => {
    const previous = openKeyRef.current;
    openKeyRef.current = openKey;
    if (!isTvMode()) return undefined;
    const frame = requestAnimationFrame(() => {
      const selector = openKey
        ? ".library-series [data-tv-initial]"
        : previous
          ? `[data-series-key="${CSS.escape(previous)}"]`
          : null;
      const el = selector ? document.querySelector(selector) : null;
      if (el) setGamepadFocus(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [openKey]);

  const setEpisodesWatched = (episodes, watchedOn) => {
    for (const episode of episodes) {
      const key = progressKey(episode);
      if (watchedOn) onMarkWatched?.(key);
      else onMarkUnwatched?.(key);
    }
  };

  const removeEpisodes = (episodes) => {
    for (const episode of episodes) onRemoveHistory?.(episode);
  };

  const removeOpenSeries = () => {
    if (!openGroup) return;
    const index = groups.findIndex((group) => group.key === openGroup.key);
    const neighbor = groups[index - 1] || groups[index + 1] || null;
    setResumeKey(neighbor ? neighbor.key : "");
    removeEpisodes(openGroup.episodes);
    setOpenKey(null);
  };

  useEffect(() => {
    if (resumeKey == null || openKey) return undefined;
    const key = resumeKey;
    setResumeKey(null);
    if (!isTvMode()) return undefined;
    const row = key
      ? document.querySelector(`[data-history-key="${CSS.escape(key)}"]`)
      : null;
    const target = row || document.querySelector("[data-history-empty]");
    if (target) setGamepadFocus(target);
    return undefined;
  }, [resumeKey, openKey, groups]);

  return (
    <div className="fade-in library-page">
      <div className="library-header">
        <div className="library-title">My Library</div>
        <div className="library-sub">
          Watch history, progress, and saved titles
        </div>
      </div>

      {inProgress.length > 0 && !openGroup && (
        <div className="library-section">
          <div className="library-section-title">Continue Watching</div>
          <div className="cards-grid">
            {inProgress.map((item, i) => {
              const pk =
                item.media_type === "movie"
                  ? `movie_${item.id}`
                  : `tv_${item.id}_s${item.season}e${item.episode}`;
              const r = getRating(item);
              const restr = itemRestricted(item);
              return (
                <MediaCard
                  key={pk}
                  item={item}
                  onClick={() => onSelect(item)}
                  progress={progress[pk] || 0}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                  ageRating={r.cert}
                  restricted={restr}
                />
              );
            })}
          </div>
        </div>
      )}

      {saved.length > 0 && !openGroup && (
        <div className="library-section">
          <div className="library-section-title">
            Watchlist ({saved.length})
            {sort !== "manual" && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: "var(--text3)",
                  marginLeft: 10,
                }}
              >
                {sortLabels[sort]}
              </span>
            )}
          </div>
          <div className="cards-grid">
            {saved.map((item) => {
              const r = getRating(item);
              const restr = itemRestricted(item);
              return (
                <MediaCard
                  key={`${item.media_type}_${item.id}`}
                  item={item}
                  onClick={() => onSelect(item)}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                  ageRating={r.cert}
                  restricted={restr}
                />
              );
            })}
          </div>
        </div>
      )}

      {openGroup?.kind === "series" && (
        <SeriesHistory
          group={openGroup}
          watched={watched}
          progress={progress}
          onBack={() => setOpenKey(null)}
          onSelect={onSelect}
          onToggleEpisode={(episode) => {
            const key = progressKey(episode);
            if (watched?.[key]) onMarkUnwatched?.(key);
            else onMarkWatched?.(key);
          }}
          onRemoveEpisode={(episode) => onRemoveHistory?.(episode)}
          onToggleSeries={(on) => setEpisodesWatched(openGroup.episodes, on)}
          onRemoveSeries={removeOpenSeries}
        />
      )}

      {history.length > 0 && !openGroup && (
        <div className="library-section">
          <div className="library-section-title">Watch History</div>
          <div className="history-rows">
            {groups.map((group) =>
              group.kind === "series" ? (
                <SeriesRow
                  key={group.key}
                  group={group}
                  watched={watched}
                  onOpen={() => setOpenKey(group.key)}
                />
              ) : (
                <HistoryEntry
                  key={`${group.key}_${group.item.watchedAt}`}
                  historyKey={group.key}
                  item={group.item}
                  watched={!!watched?.[progressKey(group.item)]}
                  progress={progress[progressKey(group.item)] || 0}
                  onOpen={() => onSelect(group.item)}
                  onToggleWatched={() => {
                    const key = progressKey(group.item);
                    if (watched?.[key]) onMarkUnwatched?.(key);
                    else onMarkWatched?.(key);
                  }}
                  onRemove={() => onRemoveHistory?.(group.item)}
                />
              ),
            )}
          </div>
        </div>
      )}

      {!openGroup && history.length === 0 && saved.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Watch History</div>
          <div
            className="empty-state history-empty"
            tabIndex={0}
            data-history-empty=""
            role="status"
          >
            <h3>Nothing in your history</h3>
            <p>Series you watch will show up here.</p>
          </div>
        </div>
      )}

      {history.length === 0 && saved.length === 0 && (
        <div
          className="empty-state"
          tabIndex={0}
          data-history-empty=""
          role="status"
        >
          <EyeIcon />
          <h3>Nothing here yet</h3>
          <p>
            Start watching a movie or series and your history will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

function Poster({ path, title }) {
  return (
    <div className="history-thumb">
      {path ? <img src={imgUrl(path, "w185")} alt="" /> : null}
      {!path && <span className="history-thumb-fallback">{title?.[0] || ""}</span>}
    </div>
  );
}

function SeriesRow({ group, watched, onOpen }) {
  const watchedCount = group.episodes.filter(
    (episode) => watched?.[progressKey(episode)],
  ).length;
  const allWatched = watchedCount === group.episodes.length;
  const latest = group.episodes.reduce((best, episode) =>
    (episode.watchedAt || 0) > (best.watchedAt || 0) ? episode : best,
  );
  const countLabel = `${group.episodes.length} episode${group.episodes.length === 1 ? "" : "s"}`;
  return (
    <div className="history-entry">
      <div
        className="history-row"
        role="button"
        tabIndex={0}
        data-series-key={group.key}
        data-history-key={group.key}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen();
        }}
      >
        <Poster path={group.poster_path} title={group.title} />
        <div className="history-copy">
          <div className="history-name">
            {group.title}
            {allWatched && <WatchedIcon size={16} />}
          </div>
          <div className="history-meta">
            {allWatched ? "Series watched" : countLabel}
            {watchedCount > 0 && !allWatched ? ` · ${watchedCount} watched` : ""}
            {latest ? ` · ${episodeLabel(latest)}` : ""}
          </div>
        </div>
        <span className="search-result-type type-tv">Series</span>
      </div>
    </div>
  );
}

function HistoryEntry({
  item,
  watched,
  progress,
  onOpen,
  onToggleWatched,
  onRemove,
  initial,
  compact,
  historyKey,
}) {
  const label = episodeLabel(item);
  return (
    <div className="history-entry">
      <div
        className="history-row"
        role="button"
        tabIndex={0}
        data-history-key={historyKey || undefined}
        data-tv-initial={initial ? "" : undefined}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen();
        }}
      >
        <Poster path={item.poster_path} title={item.title} />
        <div className="history-copy">
          <div className="history-name">
            {compact ? label : item.title}
            {watched && <WatchedIcon size={16} />}
          </div>
          <div className="history-meta">
            {compact ? "" : label ? `${label} · ` : ""}
            {formatWhen(item.watchedAt)}
            {progress > 0 && !watched ? ` · ${Math.round(progress)}%` : ""}
          </div>
          {progress > 0 && !watched && (
            <div className="history-progress">
              <div style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
          )}
        </div>
      </div>
      <div className="history-actions">
        <button className="history-action" onClick={onToggleWatched}>
          {watched ? "Watched" : "Mark watched"}
        </button>
        <button className="history-action history-action--remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

function SeriesHistory({
  group,
  watched,
  progress,
  onBack,
  onSelect,
  onToggleEpisode,
  onRemoveEpisode,
  onToggleSeries,
  onRemoveSeries,
}) {
  const watchedCount = group.episodes.filter(
    (episode) => watched?.[progressKey(episode)],
  ).length;
  const allWatched =
    group.episodes.length > 0 && watchedCount === group.episodes.length;
  return (
    <div className="library-section library-series">
      <button className="btn btn-secondary library-back" onClick={onBack}>
        All history
      </button>
      <div className="library-series-head">
        <Poster path={group.poster_path} title={group.title} />
        <div>
          <div className="library-title library-series-title">{group.title}</div>
          <div className="library-sub">
            {group.episodes.length} episode
            {group.episodes.length === 1 ? "" : "s"}
            {allWatched
              ? " · Series watched"
              : watchedCount
                ? ` · ${watchedCount} watched`
                : ""}
          </div>
        </div>
      </div>
      <div className="history-actions library-series-actions">
        <button
          className="btn btn-secondary"
          onClick={() => onToggleSeries(!allWatched)}
        >
          {allWatched ? "Mark series unwatched" : "Mark series watched"}
        </button>
        <button className="btn btn-secondary" onClick={onRemoveSeries}>
          Remove series
        </button>
      </div>
      <div className="history-rows">
        {group.episodes.map((episode, index) => (
          <HistoryEntry
            key={progressKey(episode)}
            item={episode}
            watched={!!watched?.[progressKey(episode)]}
            progress={progress[progressKey(episode)] || 0}
            initial={index === 0}
            compact
            onOpen={() => onSelect(episode)}
            onToggleWatched={() => onToggleEpisode(episode)}
            onRemove={() => onRemoveEpisode(episode)}
          />
        ))}
      </div>
    </div>
  );
}
