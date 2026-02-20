import { useState, useEffect, useCallback } from 'react'
import { storage } from './utils/storage'
import { tmdbFetch, setApiErrorHandlers } from './utils/api'

import Sidebar from './components/Sidebar'
import SearchModal from './components/SearchModal'
import SetupScreen from './components/SetupScreen'
import CloseConfirmModal from './components/CloseConfirmModal'

import HomePage from './pages/HomePage'
import MoviePage from './pages/MoviePage'
import TVPage from './pages/TVPage'
import LibraryPage from './pages/LibraryPage'
import SettingsPage from './pages/SettingsPage'
import DownloadsPage from './pages/DownloadsPage'

export default function App() {
  const [apiKey, setApiKey] = useState(() => storage.get('apikey'))
  const [apiKeyStatus, setApiKeyStatus] = useState('checking') // 'checking' | 'ok' | 'invalid_token' | 'unreachable'
  const [page, setPage] = useState('home')
  const [selected, setSelected] = useState(null)
  const [showSearch, setShowSearch] = useState(false)

  // Navigation history stack for Ctrl+Z back navigation
  const [navStack, setNavStack] = useState([])

  const [saved, setSaved] = useState(() => storage.get('saved') || {})
  // Separate order array for drag-and-drop reordering
  const [savedOrder, setSavedOrder] = useState(() => storage.get('savedOrder') || null)
  const [progress, setProgress] = useState(() => storage.get('progress') || {})
  const [history, setHistory] = useState(() => storage.get('history') || [])
  const [watched, setWatched] = useState(() => storage.get('watched') || {})
  const [toast, setToast] = useState(null)

  const [trending, setTrending] = useState([])
  const [trendingTV, setTrendingTV] = useState([])
  const [loadingHome, setLoadingHome] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)

  // ── Downloads state ──────────────────────────────────────────────────────
  const [downloads, setDownloads] = useState([])
  const [highlightDownload, setHighlightDownload] = useState(null)
  const [closeConfirm, setCloseConfirm] = useState(null) // { count }

  // Listen for close confirmation request from main process
  useEffect(() => {
    if (!window.electron) return
    const handler = window.electron.onConfirmClose((data) => setCloseConfirm(data))
    return () => window.electron.offConfirmClose(handler)
  }, [])

  // ── Register global API error handlers ──────────────────────────────────
  // Fire on any tmdbFetch call that returns 401/403 or network failure
  useEffect(() => {
    setApiErrorHandlers(
      () => setApiKeyStatus('invalid_token'),  // 401 / 403
      () => setApiKeyStatus('unreachable'),     // network failure
    )
  }, [])

  // ── Validate stored API key on startup ───────────────────────────────────
  useEffect(() => {
    if (!apiKey) { setApiKeyStatus('ok'); return }
    setApiKeyStatus('checking')
    const controller = new AbortController()
    fetch('https://api.themoviedb.org/3/configuration', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) setApiKeyStatus('invalid_token')
        else setApiKeyStatus('ok')
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        setApiKeyStatus('unreachable')
      })
    return () => controller.abort()
  }, [apiKey])

  // Load persisted downloads on startup
  useEffect(() => {
    if (!window.electron) return
    window.electron.getDownloads().then(list => {
      if (Array.isArray(list)) setDownloads(list)
    })
  }, [])

  // Listen for live progress events from main process
  useEffect(() => {
    if (!window.electron) return
    const handler = window.electron.onDownloadProgress((update) => {
      setDownloads(prev => {
        const idx = prev.findIndex(d => d.id === update.id)
        if (idx === -1) {
          // Entry not yet added by handleDownloadStarted (race on first event) — add it now
          return [update, ...prev]
        }
        const updated = [...prev]
        updated[idx] = { ...updated[idx], ...update }
        return updated
      })
    })
    return () => window.electron.offDownloadProgress(handler)
  }, [])

  const handleDownloadStarted = useCallback((newEntry) => {
    setDownloads(prev => {
      // Guard: if a progress event already added this id (race), just update it
      const idx = prev.findIndex(d => d.id === newEntry.id)
      if (idx !== -1) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], ...newEntry }
        return updated
      }
      return [newEntry, ...prev]
    })
  }, [])

  const handleDeleteDownload = useCallback((id) => {
    setDownloads(prev => prev.filter(d => d.id !== id))
  }, [])

  // Active download count for sidebar badge
  const activeDownloadCount = downloads.filter(d => d.status === 'downloading').length

  // ── Trending ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!apiKey) return
    setLoadingHome(true)
    Promise.all([
      tmdbFetch('/trending/movie/week', apiKey),
      tmdbFetch('/trending/tv/week', apiKey),
    ])
      .then(([m, t]) => { setTrending(m.results || []); setTrendingTV(t.results || []) })
      .catch(() => { })
      .finally(() => setLoadingHome(false))
  }, [apiKey])

  // ── Network status ───────────────────────────────────────────────────────
  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // ── Navigation ────────────────────────────────────────────────────────────
  const navigateBack = useCallback(() => {
    setNavStack(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setPage(last.page)
      setSelected(last.selected)
      return prev.slice(0, -1)
    })
  }, [])

  const navigate = (pg, data = null) => {
    setNavStack(prev => [...prev, { page, selected }])
    setSelected(data)
    setPage(pg)
    setShowSearch(false)
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true) }
      if (e.key === 'Escape') setShowSearch(false)
      // Ctrl+Z / Cmd+Z → navigate back
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        navigateBack()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigateBack])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const retryHome = () => {
    if (!apiKey || offline) return
    setLoadingHome(true)
    Promise.all([
      tmdbFetch('/trending/movie/week', apiKey),
      tmdbFetch('/trending/tv/week', apiKey),
    ])
      .then(([m, t]) => { setTrending(m.results || []); setTrendingTV(t.results || []) })
      .catch(() => { })
      .finally(() => setLoadingHome(false))
  }

  const handleSelectResult = (item) => {
    navigate(item.media_type === 'tv' ? 'tv' : 'movie', item)
  }

  const saveApiKey = (key) => { storage.set('apikey', key); setApiKey(key) }

  const changeApiKey = () => {
    if (confirm('Reset TMDB API Read Access Token?')) { storage.remove('apikey'); setApiKey(null) }
  }

  const toggleSave = useCallback((item) => {
    const id = `${item.media_type || (item.first_air_date ? 'tv' : 'movie')}_${item.id}`
    const next = { ...saved }
    if (next[id]) {
      delete next[id]
      showToast('Removed from watchlist')
      setSavedOrder(prev => {
        const currentOrder = prev || Object.keys(saved)
        const newOrder = currentOrder.filter(k => k !== id)
        storage.set('savedOrder', newOrder)
        return newOrder
      })
    } else {
      next[id] = {
        id: item.id, title: item.title || item.name, poster_path: item.poster_path,
        media_type: item.media_type || (item.first_air_date ? 'tv' : 'movie'),
        vote_average: item.vote_average,
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
      }
      showToast('Added to watchlist')
      setSavedOrder(prev => {
        const currentOrder = prev || Object.keys(saved)
        const newOrder = [...currentOrder, id]
        storage.set('savedOrder', newOrder)
        return newOrder
      })
    }
    setSaved(next); storage.set('saved', next)
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
      // Store as numbers so the progress key always matches exactly
      season: item.season != null ? Number(item.season) : null,
      episode: item.episode != null ? Number(item.episode) : null,
      episodeName: item.episodeName || null,
    }
    // Functional update — never reads stale history from closure
    setHistory(prev => {
      const filtered = prev.filter(h => !(h.id === entry.id && h.media_type === entry.media_type))
      const next = [entry, ...filtered].slice(0, 50)
      storage.set('history', next)
      return next
    })
  }, []) // no deps needed — functional update always sees latest state

  const saveProgress = useCallback((key, pct) => {
    // Functional update — without this, TVPage's setInterval keeps spreading
    // the progress object from when the interval was created, overwriting
    // saves from other episodes (classic stale closure bug).
    setProgress(prev => {
      if (prev[key] === pct) return prev // no change — skip write
      const next = { ...prev, [key]: pct }
      storage.set('progress', next)
      return next
    })
  }, []) // no deps needed

  const markWatched = useCallback((key) => {
    setWatched(prev => {
      const next = { ...prev, [key]: true }
      storage.set('watched', next)
      return next
    })
  }, [])

  const markUnwatched = useCallback((key) => {
    setWatched(prev => {
      const next = { ...prev }
      delete next[key]
      storage.set('watched', next)
      return next
    })
  }, [])

  const inProgress = history.filter(h => {
    // Guard: TV entries must have valid season + episode to form a matchable key
    if (h.media_type === 'tv' && (h.season == null || h.episode == null)) return false
    const pk = h.media_type === 'movie'
      ? `movie_${h.id}`
      : `tv_${h.id}_s${h.season}e${h.episode}`
    const pct = progress[pk]
    // Exclude watched items and items not meaningfully started or already finished
    if (watched[pk]) return false
    return pct != null && pct > 2 && pct < 98
  })

  // Build savedList respecting drag-and-drop order
  const orderedKeys = savedOrder ? savedOrder.filter(k => saved[k]) : Object.keys(saved)
  const savedList = orderedKeys.map(k => saved[k]).filter(Boolean)

  const handleReorderSaved = useCallback((newOrder) => {
    setSavedOrder(newOrder)
    storage.set('savedOrder', newOrder)
  }, [])

  if (!apiKey) return <SetupScreen onSave={saveApiKey} />

  return (
    <>
      <Sidebar
        page={page}
        onNavigate={navigate}
        onSearch={() => setShowSearch(true)}
        savedList={savedList}
        activeDownloads={activeDownloadCount}
        onReorderSaved={handleReorderSaved}
        canGoBack={navStack.length > 0}
        onBack={navigateBack}
      />

      <div className="main">
        {/* ── API key status banner ── */}
        {apiKeyStatus === 'invalid_token' && (
          <div className="api-status-banner api-status-error">
            <span>⚠ Your TMDB token is invalid or has been revoked. Movies and shows won't load.</span>
            <button className="api-status-btn" onClick={changeApiKey}>Update Token</button>
          </div>
        )}
        {apiKeyStatus === 'unreachable' && (
          <div className="api-status-banner api-status-warn">
            <span>⚠ Cannot reach TMDB, check your internet connection. Content may not load.</span>
            <button className="api-status-btn" onClick={() => setApiKeyStatus('checking') || window.location.reload()}>Retry</button>
          </div>
        )}
        {page === 'home' && (
          <HomePage trending={trending} trendingTV={trendingTV} loading={loadingHome}
            onSelect={handleSelectResult} progress={progress} inProgress={inProgress}
            offline={offline} onRetry={retryHome}
            watched={watched} onMarkWatched={markWatched} onMarkUnwatched={markUnwatched} />
        )}
        {page === 'movie' && selected && (
          <MoviePage item={selected} apiKey={apiKey}
            onSave={() => toggleSave(selected)} isSaved={isSaved(selected)}
            onHistory={addHistory} progress={progress} saveProgress={saveProgress}
            onBack={() => navigate('home')} onSettings={() => navigate('settings')}
            onDownloadStarted={handleDownloadStarted}
            watched={watched} onMarkWatched={markWatched} onMarkUnwatched={markUnwatched}
            downloads={downloads}
            onGoToDownloads={(id) => { setHighlightDownload(id || null); navigate('downloads') }}
          />
        )}
        {page === 'tv' && selected && (
          <TVPage item={selected} apiKey={apiKey}
            onSave={() => toggleSave(selected)} isSaved={isSaved(selected)}
            onHistory={addHistory} progress={progress} saveProgress={saveProgress}
            onBack={() => navigate('home')} onSettings={() => navigate('settings')}
            onDownloadStarted={handleDownloadStarted}
            watched={watched} onMarkWatched={markWatched} onMarkUnwatched={markUnwatched}
            downloads={downloads}
            onGoToDownloads={(id) => { setHighlightDownload(id || null); navigate('downloads') }}
          />
        )}
        {page === 'history' && (
          <LibraryPage history={history} inProgress={inProgress} saved={savedList}
            progress={progress} onSelect={handleSelectResult}
            watched={watched} onMarkWatched={markWatched} onMarkUnwatched={markUnwatched} />
        )}
        {page === 'settings' && (
          <SettingsPage apiKey={apiKey} onChangeApiKey={changeApiKey} />
        )}
        {page === 'downloads' && (
          <DownloadsPage
            downloads={downloads}
            onDeleteDownload={handleDeleteDownload}
            onHistory={addHistory}
            onSaveProgress={saveProgress}
            progress={progress}
            watched={watched}
            onMarkWatched={markWatched}
            onMarkUnwatched={markUnwatched}
            highlightId={highlightDownload}
            onClearHighlight={() => setHighlightDownload(null)}
          />
        )}
      </div>

      {showSearch && (
        <SearchModal apiKey={apiKey} onSelect={handleSelectResult} onClose={() => setShowSearch(false)} offline={offline} />
      )}
      {toast && <div className="toast">{toast}</div>}
      {closeConfirm && (
        <CloseConfirmModal
          count={closeConfirm.count}
          onConfirm={() => { setCloseConfirm(null); window.electron.respondClose(true) }}
          onCancel={() => { setCloseConfirm(null); window.electron.respondClose(false) }}
        />
      )}
    </>
  )
}
