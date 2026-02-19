const TMDB_BASE = 'https://api.themoviedb.org/3'
const IMG_BASE = 'https://image.tmdb.org/t/p'

export const imgUrl = (path, size = 'w500') =>
  path ? `${IMG_BASE}/${size}${path}` : null

export const tmdbFetch = async (path, apiKey) => {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json()
}

export const videasyMovieUrl = (id) => `https://player.videasy.net/movie/${id}`
export const videasyTVUrl = (id, season, episode) =>
  `https://player.videasy.net/tv/${id}/${season}/${episode}`
