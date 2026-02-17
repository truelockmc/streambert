import { imgUrl } from '../utils/api'
import {
  StreambertLogo, HomeIcon, SearchIcon, HistoryIcon,
  FilmIcon, SettingsIcon, DownloadsQueueIcon,
} from './Icons'

export default function Sidebar({ page, onNavigate, onSearch, savedList, activeDownloads }) {
  return (
    <div className="sidebar">
      <div className="sidebar-logo" onClick={() => onNavigate('home')} title="Streambert">
        <StreambertLogo />
      </div>

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
        {savedList.map(item => (
          <div
            key={`${item.media_type}_${item.id}`}
            className="saved-thumb"
            onClick={() => onNavigate(item.media_type === 'tv' ? 'tv' : 'movie', item)}
            title={item.title}
          >
            {item.poster_path
              ? <img src={imgUrl(item.poster_path, 'w200')} alt={item.title} />
              : <div className="no-img"><FilmIcon /></div>
            }
          </div>
        ))}
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
