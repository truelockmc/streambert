import { imgUrl } from '../utils/api'
import {
  StreambertLogo, HomeIcon, SearchIcon, HistoryIcon,
  FilmIcon, SettingsIcon,
} from './Icons'

export default function Sidebar({ page, onNavigate, onSearch, savedList }) {
  return (
    <div className="sidebar">
      <div className="sidebar-logo" onClick={() => onNavigate('home')} title="Streambert">
        <StreambertLogo />
      </div>

      <SideBtn
        active={page === 'home'}
        onClick={() => onNavigate('home')}
        icon={<HomeIcon />}
        label="Home"
      />
      <SideBtn
        onClick={onSearch}
        icon={<SearchIcon />}
        label="Search  (⌘K)"
      />
      <SideBtn
        active={page === 'history'}
        onClick={() => onNavigate('history')}
        icon={<HistoryIcon />}
        label="Library & History"
      />

      <div className="sidebar-sep" />

      {/* Saved thumbnails */}
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
        <SideBtn
          active={page === 'settings'}
          onClick={() => onNavigate('settings')}
          icon={<SettingsIcon />}
          label="Settings"
        />
      </div>
    </div>
  )
}

function SideBtn({ active, onClick, icon, label }) {
  return (
    <button className={`sidebar-btn ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span className="tooltip">{label}</span>
    </button>
  )
}
