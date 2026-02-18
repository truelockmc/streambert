import { useState, useRef } from 'react'
import { imgUrl } from '../utils/api'
import {
  StreambertLogo, HomeIcon, SearchIcon, HistoryIcon,
  FilmIcon, SettingsIcon, DownloadsQueueIcon,
} from './Icons'

export default function Sidebar({ page, onNavigate, onSearch, savedList, activeDownloads, onReorderSaved, canGoBack, onBack }) {
  const [dragOver, setDragOver] = useState(null)
  const dragItem = useRef(null)
  const dragNode = useRef(null)

  const handleDragStart = (e, index) => {
    dragItem.current = index
    dragNode.current = e.currentTarget
    setTimeout(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4'
    }, 0)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = '1'
    dragItem.current = null
    dragNode.current = null
    setDragOver(null)
  }

  const handleDragEnter = (e, index) => {
    if (dragItem.current === index) return
    setDragOver(index)
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    const fromIndex = dragItem.current
    if (fromIndex === null || fromIndex === dropIndex) return

    const newList = [...savedList]
    const [moved] = newList.splice(fromIndex, 1)
    newList.splice(dropIndex, 0, moved)

    const newOrder = newList.map(item => `${item.media_type}_${item.id}`)
    onReorderSaved(newOrder)
    setDragOver(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  return (
    <div className="sidebar">
      <div className="sidebar-logo" onClick={() => onNavigate('home')} title="Streambert">
        <StreambertLogo />
      </div>

      {canGoBack && (
        <SideBtn
          onClick={onBack}
          icon={<BackIcon />}
          label="Back (Ctrl+Z)"
        />
      )}

      <SideBtn active={page === 'home'} onClick={() => onNavigate('home')} icon={<HomeIcon />} label="Home" />
      <SideBtn onClick={onSearch} icon={<SearchIcon />} label="Search  (⌘K)" />
      <SideBtn active={page === 'history'} onClick={() => onNavigate('history')} icon={<HistoryIcon />} label="Library & History" />
      <SideBtn
        active={page === 'downloads'}
        onClick={() => onNavigate('downloads')}
        icon={<DownloadsQueueIcon />}
        label="Downloads"
        badge={activeDownloads > 0 ? activeDownloads : null}
      />

      <div className="sidebar-sep" />

      <div className="sidebar-saved">
        {savedList.map((item, index) => {
          const key = `${item.media_type}_${item.id}`
          return (
            <div
              key={key}
              className={`saved-thumb${dragOver === index ? ' drag-over' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() => onNavigate(item.media_type === 'tv' ? 'tv' : 'movie', item)}
              title={item.title}
              style={{ cursor: 'grab', position: 'relative' }}
            >
              {item.poster_path
                ? <img src={imgUrl(item.poster_path, 'w200')} alt={item.title} />
                : <div className="no-img"><FilmIcon /></div>
              }
              {dragOver === index && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  height: 3, background: 'var(--accent, #e50914)',
                  borderRadius: 2, pointerEvents: 'none',
                }} />
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <SideBtn active={page === 'settings'} onClick={() => onNavigate('settings')} icon={<SettingsIcon />} label="Settings" />
      </div>
    </div>
  )
}

function SideBtn({ active, onClick, icon, label, badge }) {
  return (
    <button className={`sidebar-btn ${active ? 'active' : ''}`} onClick={onClick} style={{ position: 'relative' }}>
      {icon}
      <span className="tooltip">{label}</span>
      {badge && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          minWidth: 16, height: 16, borderRadius: 8,
          background: 'var(--red)', color: 'white',
          fontSize: 10, fontWeight: 700, lineHeight: '16px',
          textAlign: 'center', padding: '0 4px',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

function BackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}
