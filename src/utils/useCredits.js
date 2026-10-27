import { useEffect, useState } from "react";
import { tmdbFetch } from "./api";

const EMPTY = { cast: [], crew: [] };

/**
 * Loads cast & crew for a movie or TV show.
 * TV uses aggregate_credits so that roles/jobs across all seasons are included.
 */
export function useCredits(type, id, apiKey) {
  const [credits, setCredits] = useState(EMPTY);

  useEffect(() => {
    let mounted = true;
    setCredits(EMPTY);
    const path =
      type === "tv" ? `/tv/${id}/aggregate_credits` : `/movie/${id}/credits`;

    tmdbFetch(path, apiKey)
      .then((data) => {
        if (!mounted) return;
        setCredits({ cast: data?.cast || [], crew: data?.crew || [] });
      })
      .catch(() => {
        if (mounted) setCredits(EMPTY);
      });

    return () => {
      mounted = false;
    };
  }, [type, id, apiKey]);

  return credits;
}
