const TMDB_BASE = 'https://api.themoviedb.org/3'
const IMG_BASE = 'https://image.tmdb.org/t/p'

export const imgUrl = (path, size = 'w500') =>
  path ? `${IMG_BASE}/${size}${path}` : null

// Global auth-error callback, registered by App on mount
let _onAuthError = null
let _onUnreachable = null
export const setApiErrorHandlers = (onAuth, onUnreachable) => {
  _onAuthError = onAuth
  _onUnreachable = onUnreachable
}

export const tmdbFetch = async (path, apiKey) => {
  let res
  try {
    res = await fetch(`${TMDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    // Network failure
    _onUnreachable?.()
    throw new Error('TMDB unreachable')
  }

  if (res.status === 401 || res.status === 403) {
    _onAuthError?.()
    throw new Error(`TMDB ${res.status}`)
  }

  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json()
}

export const videasyMovieUrl = (id) => `https://player.videasy.net/movie/${id}`
export const videasyTVUrl = (id, season, episode) =>
  `https://player.videasy.net/tv/${id}/${season}/${episode}`
