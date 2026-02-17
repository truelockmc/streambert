import { useState, useEffect, useCallback } from 'react'
import { storage } from './utils/storage'
import { tmdbFetch } from './utils/api'

import Sidebar from './components/Sidebar'
import SearchModal from './components/SearchModal'
import SetupScreen from './components/SetupScreen'

import HomePage from './pages/HomePage'
import MoviePage from './pages/MoviePage'
import TVPage from './pages/TVPage'
import LibraryPage from './pages/LibraryPage'

export default function App() {
  const [apiKey, setApiKey]   = useState(() => storage.get('apikey'))
  const [page, setPage]       = useState('home')
  const [selected, setSelected] = useState(null)
  const [showSearch, setShowSearch] = useState(false)

  const [saved, setSaved]         = useState(() => storage.get('saved') || {})
  const [progress, setProgress]   = useState(() => storage.get('progress') || {})
  const [history, setHistory]     = useState(() => storage.get('history') || [])
  const [toast, setToast]         = useState(null)

  const [trending, setTrending]     = useState([])
  const [trendingTV, setTrendingTV] = useState([])
  const [loadingHome, setLoadingHome] = useState(false)

  // ── Load trending on startup ───────────────────────────────────────────────
  useEffect(() => {
    if (!apiKey) return
    setLoadingHome(true)
    Promise.all([
      tmdbFetch('/trending/movie/week', apiKey),
      tmdbFetch('/trending/tv/week', apiKey),
    ])
      .then(([m, t]) => { setTrending(m.results || []); setTrendingTV(t.results || []) })
      .catch(() => {})
      .finally(() => setLoadingHome(false))
  }, [apiKey])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true) }
      if (e.key === 'Escape') setShowSearch(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const navigate = (pg, data = null) => {
    setSelected(data)
    setPage(pg)
    setShowSearch(false)
  }

  const handleSelectResult = (item) => {
    navigate(item.media_type === 'tv' ? 'tv' : 'movie', item)
  }

  const saveApiKey = (key) => {
    storage.set('apikey', key)
    setApiKey(key)
  }

  const toggleSave = useCallback((item) => {
    const id = `${item.media_type || (item.first_air_date ? 'tv' : 'movie')}_${item.id}`
    const next = { ...saved }
    if (next[id]) {
      delete next[id]
      showToast('Removed from watchlist')
    } else {
      next[id] = {
        id: item.id,
        title: item.title || item.name,
        poster_path: item.poster_path,
        media_type: item.media_type || (item.first_air_date ? 'tv' : 'movie'),
        vote_average: item.vote_average,
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
      }
      showToast('Added to watchlist')
    }
    setSaved(next)
    storage.set('saved', next)
  }, [saved])

  const isSaved = (item) => {
    const id = `${item.media_type || (item.first_air_date ? 'tv' : 'movie')}_${item.id}`
    return !!saved[id]
  }

  const addHistory = useCallback((item) => {
    const entry = {
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      media_type: item.media_type || (item.first_air_date ? 'tv' : 'movie'),
      watchedAt: Date.now(),
      season: item.season,
      episode: item.episode,
      episodeName: item.episodeName,
    }
    const filtered = history.filter(
      h => !(h.id === item.id && h.media_type === entry.media_type)
    )
    const next = [entry, ...filtered].slice(0, 50)
    setHistory(next)
    storage.set('history', next)
  }, [history])

  const saveProgress = useCallback((key, pct) => {
    const next = { ...progress, [key]: pct }
    setProgress(next)
    storage.set('progress', next)
  }, [progress])

  // ── Derived: in-progress items ────────────────────────────────────────────
  const inProgress = history.filter(h => {
    const pk = h.media_type === 'movie'
      ? `movie_${h.id}`
      : `tv_${h.id}_s${h.season}e${h.episode}`
    const pct = progress[pk]
    return pct && pct > 2 && pct < 95
  })

  const savedList = Object.values(saved)

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!apiKey) return <SetupScreen onSave={saveApiKey} />

  return (
    <>
      <Sidebar
        page={page}
        onNavigate={navigate}
        onSearch={() => setShowSearch(true)}
        savedList={savedList}
      />

      <div className="main">
        {page === 'home' && (
          <HomePage
            trending={trending}
            trendingTV={trendingTV}
            loading={loadingHome}
            onSelect={handleSelectResult}
            progress={progress}
            inProgress={inProgress}
          />
        )}
        {page === 'movie' && selected && (
          <MoviePage
            item={selected}
            apiKey={apiKey}
            onSave={() => toggleSave(selected)}
            isSaved={isSaved(selected)}
            onHistory={addHistory}
            progress={progress}
            saveProgress={saveProgress}
            onBack={() => navigate('home')}
          />
        )}
        {page === 'tv' && selected && (
          <TVPage
            item={selected}
            apiKey={apiKey}
            onSave={() => toggleSave(selected)}
            isSaved={isSaved(selected)}
            onHistory={addHistory}
            progress={progress}
            saveProgress={saveProgress}
            onBack={() => navigate('home')}
          />
        )}
        {page === 'history' && (
          <LibraryPage
            history={history}
            inProgress={inProgress}
            saved={savedList}
            progress={progress}
            onSelect={handleSelectResult}
          />
        )}
      </div>

      {showSearch && (
        <SearchModal
          apiKey={apiKey}
          onSelect={handleSelectResult}
          onClose={() => setShowSearch(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
