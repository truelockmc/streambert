import { useEffect, useState } from "react";
import { fetchImdbId, sourceNeedsImdb } from "./api";

/**
 * Returns the ID a player source expects for a TMDB title.
 *  - normal sources:   the TMDB id itself (instantly)
 *  - IMDb sources:     the converted IMDb id (id = null while resolving)
 *
 * @returns {{ id: number|string|null, loading: boolean, error: string|null }}
 */
export function useSourceId(sourceId, type, tmdbId, apiKey) {
  const needsImdb = sourceNeedsImdb(sourceId);
  const [state, setState] = useState({ key: null, id: null, error: null });
  const key = needsImdb ? `${type}:${tmdbId}` : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchImdbId(type, tmdbId, apiKey)
      .then((id) => !cancelled && setState({ key, id, error: null }))
      .catch((e) => !cancelled && setState({ key, id: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [key, type, tmdbId, apiKey]);

  if (!needsImdb) return { id: tmdbId, loading: false, error: null };
  // Ignore results that belong to a previous title
  if (state.key !== key) return { id: null, loading: true, error: null };
  return { id: state.id, loading: !state.id && !state.error, error: state.error };
}
