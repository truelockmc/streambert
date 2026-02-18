import { useState, useEffect } from 'react'
import { tmdbFetch, imgUrl, videasyTVUrl } from '../utils/api'
import {
  BookmarkIcon, BookmarkFillIcon, BackIcon, StarIcon,
  PlayIcon, TVIcon, DownloadIcon,
} from '../components/Icons'
import DownloadModal from '../components/DownloadModal'
import { storage } from '../utils/storage'

export default function TVPage({
  item, apiKey, onSave, isSaved, onHistory, progress, saveProgress, onBack, onSettings, onDownloadStarted,
}) {
  const [details, setDetails]           = useState(null)
  const [seasonData, setSeasonData]     = useState(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [selectedEp, setSelectedEp]     = useState(null)
  const [playing, setPlaying]           = useState(false)
  const [loading, setLoading]           = useState(true)
  const [loadingSeason, setLoadingSeason] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [m3u8Url, setM3u8Url]           = useState(null)
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get('downloaderFolder') || ''
  )

  useEffect(() => {
    setLoading(true)
    tmdbFetch(`/tv/${item.id}`, apiKey)
      .then(d => {
        setDetails(d)
        const first = d.seasons?.find(s => s.season_number > 0) || d.seasons?.[0]
        if (first) setSelectedSeason(first.season_number)
      })
      .catch(() => setDetails(item))
      .finally(() => setLoading(false))
  }, [item.id, apiKey])

  useEffect(() => {
    if (!apiKey || !item.id) return
    setLoadingSeason(true)
    setSelectedEp(null)
    setPlaying(false)
    tmdbFetch(`/tv/${item.id}/season/${selectedSeason}`, apiKey)
      .then(setSeasonData)
      .catch(() => {})
      .finally(() => setLoadingSeason(false))
  }, [item.id, selectedSeason, apiKey])

  useEffect(() => {
    if (!window.electron) return
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url(prev => prev || url)
    })
    return () => window.electron.offM3u8Found(handler)
  }, [])

  const d = details || item
  const title = d.name || d.title
  const year = (d.first_air_date || '').slice(0, 4)
  const seasons = (d.seasons || []).filter(s => s.season_number > 0)

  const currentProgressKey = selectedEp
    ? `tv_${item.id}_s${selectedSeason}e${selectedEp.episode_number}`
    : null

  // ── Auto-track progress every 5s via webview.executeJavaScript ──────────
  useEffect(() => {
    if (!playing || !currentProgressKey) return
    let interval = null
    const timer = setTimeout(() => {
      interval = setInterval(async () => {
        try {
          const wv = document.querySelector('webview')
          if (!wv) return
          const result = await wv.executeJavaScript(`
            (() => {
              const v = document.querySelector('video')
              if (!v || !v.duration || v.duration === Infinity || v.paused) return null
              return { currentTime: v.currentTime, duration: v.duration }
            })()
          `)
          if (result && result.duration > 0) {
            const p = Math.floor((result.currentTime / result.duration) * 100)
            if (p > 1) saveProgress(currentProgressKey, Math.min(p, 100))
          }
        } catch {}
      }, 5000)
    }, 3000)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [playing, currentProgressKey])

  const playEpisode = (ep) => {
    setM3u8Url(null)
    setSelectedEp(ep)
    setPlaying(true)
    onHistory({ ...d, media_type:'tv', season:selectedSeason, episode:ep.episode_number, episodeName:ep.name })
  }

  const handleSetDownloaderFolder = (folder) => {
    setDownloaderFolder(folder)
    storage.set('downloaderFolder', folder)
  }

  const mediaName = selectedEp
    ? `${title} (${year}) S${String(selectedSeason).padStart(2,'0')} E${String(selectedEp.episode_number).padStart(2,'0')}`
    : title

  return (
    <div className="fade-in">
      {loading && <div className="loader"><div className="spinner" /></div>}
      {!loading && (
        <>
          <div className="detail-hero">
            <div className="detail-bg" style={{ backgroundImage:`url(${imgUrl(d.backdrop_path,'original')})` }} />
            <div className="detail-gradient" />
            <div className="detail-content">
              <div className="detail-poster">
                {d.poster_path
                  ? <img src={imgUrl(d.poster_path)} alt={title} />
                  : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)' }}><TVIcon /></div>
                }
              </div>
              <div className="detail-info">
                <div className="detail-type">Series</div>
                <div className="detail-title">{title}</div>
                <div className="genres">
                  {(d.genres||[]).map(g=><span key={g.id} className="genre-tag">{g.name}</span>)}
                </div>
                <div className="detail-meta">
                  {d.vote_average>0&&<span className="detail-rating"><StarIcon/> {d.vote_average?.toFixed(1)}</span>}
                  {year&&<span>{year}</span>}
                  {d.number_of_seasons&&<span>{d.number_of_seasons} Seasons</span>}
                  {d.number_of_episodes&&<span>{d.number_of_episodes} Episodes</span>}
                </div>
                <p className="detail-overview">{d.overview}</p>
                <div className="detail-actions">
                  <button className="btn btn-secondary" onClick={onSave}>
                    {isSaved?<BookmarkFillIcon/>:<BookmarkIcon/>}
                    {isSaved?'Saved':'Save'}
                  </button>
                  <button className="btn btn-ghost" onClick={onBack}>
                    <BackIcon/> Back
                  </button>
                </div>
              </div>
            </div>
          </div>

          {playing && selectedEp && (
            <div className="section">
              <div style={{ marginBottom:12,display:'flex',alignItems:'center',gap:12 }}>
                <span className="tag tag-red">Season {selectedSeason} · E{selectedEp.episode_number}</span>
                <span style={{ fontSize:14,fontWeight:500 }}>{selectedEp.name}</span>
              </div>
              <div className="player-wrap">
                <webview
                  src={videasyTVUrl(item.id, selectedSeason, selectedEp.episode_number)}
                  partition="persist:videasy"
                  allowpopups="true"
                  style={{ position:'absolute',inset:0,width:'100%',height:'100%',border:'none' }}
                />
                <button className="player-overlay-btn" onClick={() => setShowDownload(true)} title="Download">
                  <DownloadIcon />
                  {m3u8Url && <span className="player-overlay-dot" />}
                </button>
              </div>
              {currentProgressKey && (
                <div className="progress-mark-row">
                  <span style={{ fontSize:12,color:'var(--text3)',marginRight:4 }}>Mark progress:</span>
                  {[25,50,75,100].map(p=>(
                    <button key={p} className="btn btn-ghost" style={{ padding:'5px 14px',fontSize:12 }}
                      onClick={()=>saveProgress(currentProgressKey,p)}>{p}%</button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="section">
            <div className="section-title">Episodes</div>
            {seasons.length>0&&(
              <div className="season-selector">
                {seasons.map(s=>(
                  <button key={s.season_number}
                    className={`season-btn ${selectedSeason===s.season_number?'active':''}`}
                    onClick={()=>setSelectedSeason(s.season_number)}>
                    Season {s.season_number}
                  </button>
                ))}
              </div>
            )}
            {loadingSeason&&<div className="loader"><div className="spinner"/></div>}
            {!loadingSeason&&seasonData?.episodes&&(
              <div className="episodes-grid">
                {seasonData.episodes.map(ep=>{
                  const pk=`tv_${item.id}_s${selectedSeason}e${ep.episode_number}`
                  const epPct=progress[pk]||0
                  const isPlaying=playing&&selectedEp?.episode_number===ep.episode_number
                  return (
                    <div key={ep.episode_number} className={`episode-card ${isPlaying?'playing':''}`} onClick={()=>playEpisode(ep)}>
                      <div className="episode-thumb">
                        {ep.still_path
                          ?<img src={imgUrl(ep.still_path,'w300')} alt={ep.name} loading="lazy"/>
                          :<div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)' }}><PlayIcon/></div>
                        }
                        <div className="episode-thumb-play"><PlayIcon/></div>
                        {epPct>0&&(
                          <div style={{ position:'absolute',bottom:0,left:0,right:0,height:3,background:'rgba(255,255,255,0.1)' }}>
                            <div style={{ width:`${Math.min(epPct,100)}%`,height:'100%',background:'var(--red)' }}/>
                          </div>
                        )}
                      </div>
                      <div className="episode-info">
                        <div className="episode-num">E{ep.episode_number}</div>
                        <div className="episode-name">{ep.name}</div>
                        <div className="episode-desc">{ep.overview}</div>
                        {epPct>0&&(
                          <div className="episode-progress-bar">
                            <div className="episode-progress-fill" style={{ width:`${Math.min(epPct,100)}%` }}/>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          m3u8Url={m3u8Url}
          mediaName={mediaName}
          downloaderFolder={downloaderFolder}
          setDownloaderFolder={handleSetDownloaderFolder}
          onOpenSettings={onSettings}
          onDownloadStarted={onDownloadStarted}
          mediaId={item.id}
          mediaType="tv"
          season={selectedSeason}
          episode={selectedEp?.episode_number}
          posterPath={d.poster_path}
          tmdbId={item.id}
        />
      )}
    </div>
  )
}
