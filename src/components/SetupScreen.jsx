import { useState } from 'react'
import { StreambertLogo, PlayIcon } from './Icons'

export default function SetupScreen({ onSave }) {
  const [key, setKey] = useState('')

  return (
    <div className="apikey-modal">
      <div className="apikey-box">
        <div className="apikey-logo"><StreambertLogo /></div>
        <div className="apikey-title">STREAMBERT</div>
        <p className="apikey-sub">
          Enter your free TMDB API key to get started.<br />
          Get one at{' '}
          <a className="apikey-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
            themoviedb.org
          </a>
        </p>
        <input
          className="apikey-input"
          placeholder="Paste your TMDB API key..."
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && key.trim() && onSave(key.trim())}
          autoFocus
        />
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
          onClick={() => key.trim() && onSave(key.trim())}
        >
          <PlayIcon /> Let's go
        </button>
      </div>
    </div>
  )
}
