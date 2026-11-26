/**
 * Show-specific episode group mappings.
 *
 * Some shows have a mismatch between TMDB season/episode numbering and
 * what streaming sources serve (e.g. Netflix re-cuts, combined seasons).
 *
 * Each entry maps a TMDB show ID to a TMDB Episode Group ID.
 * The group is fetched once from the TMDB API and cached, it defines
 * the exact season/episode numbering that streaming sources use.
 *
 * To find a group ID: https://www.themoviedb.org/tv/{id}/episode_groups
 */
export const EPISODE_GROUP_IDS = {
  // Money Heist / La Casa de Papel, Netflix order (13+9+8+8+5+5 eps)
  71446: "5eb730dfca7ec6001f7beb51",
};

/**
 * Apply a dynamic episode group mapping if one is loaded.
 * Falls through unchanged when no mapping is available.
 *
 * @param {number|string} tmdbId
 * @param {number} season
 * @param {number} episode
 * @param {Map|null} groupMap  Built by buildEpisodeGroupMap()
 * @returns {{ season: number, episode: number }}
 */
export function applyEpisodeMapping(tmdbId, season, episode, groupMap) {
  if (!groupMap) return { season, episode };
  const mapped = groupMap.get(`${season}_${episode}`);
  if (!mapped) return { season, episode };
  return mapped;
}

/**
 * Build a lookup Map from a raw TMDB episode group API response.
 * Key:   "tmdbSeason_tmdbEpisode"
 * Value: { season, episode } for the streaming source
 *
 * @param {object} groupData  Raw response from /tv/episode_group/{id}
 * @returns {Map}
 */
export function buildEpisodeGroupMap(groupData) {
  const map = new Map();
  if (!groupData?.groups) return map;

  const sortedGroups = [...groupData.groups].sort((a, b) => a.order - b.order);
  sortedGroups.forEach((group, groupIndex) => {
    const sourceSeason = groupIndex + 1;
    const sortedEpisodes = [...(group.episodes || [])].sort(
      (a, b) => a.order - b.order,
    );
    sortedEpisodes.forEach((ep, epIndex) => {
      map.set(`${ep.season_number}_${ep.episode_number}`, {
        season: sourceSeason,
        episode: epIndex + 1,
      });
    });
  });

  return map;
}
