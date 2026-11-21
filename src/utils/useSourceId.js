import { useEffect, useState } from "react";
import { fetchImdbId, fetchKinopoiskId, sourceIdType } from "./api";

const LABELS = { imdb: "IMDb ID", kinopoisk: "Kinopoisk ID" };

/**
 * Returns the ID a player source expects for a TMDB title.
 *  - normal sources:      the TMDB id itself (instantly)
 *  - IMDb sources:        the converted IMDb id (id = null while resolving)
 *  - Kinopoisk sources:   the Kinopoisk id resolved via Wikidata
 *
 * @returns {{ id: number|string|null, loading: boolean, error: string|null, idLabel: string }}
 */
export function useSourceId(sourceId, type, tmdbId, apiKey) {
  const idType = sourceIdType(sourceId);
  const needsConversion = idType === "imdb" || idType === "kinopoisk";
  const [state, setState] = useState({ key: null, id: null, error: null });
  const key = needsConversion ? `${idType}:${type}:${tmdbId}` : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const resolve = idType === "kinopoisk" ? fetchKinopoiskId : fetchImdbId;
    resolve(type, tmdbId, apiKey)
      .then((id) => !cancelled && setState({ key, id, error: null }))
      .catch((e) => !cancelled && setState({ key, id: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [key, idType, type, tmdbId, apiKey]);

  const idLabel = LABELS[idType] ?? "ID";
  if (!needsConversion) {
    return { id: tmdbId, loading: false, error: null, idLabel };
  }
  // Ignore results that belong to a previous title / source type
  if (state.key !== key) return { id: null, loading: true, error: null, idLabel };
  return {
    id: state.id,
    loading: !state.id && !state.error,
    error: state.error,
    idLabel,
  };
}
