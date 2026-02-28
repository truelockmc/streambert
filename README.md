[![Downloads@latest](https://img.shields.io/github/downloads/truelockmc/streambert/latest/total?style=for-the-badge)](https://github.com/truelockmc/streambert/releases/download/latest/)
[![Release Version Badge](https://img.shields.io/github/v/release/truelockmc/streambert?style=for-the-badge)](https://github.com/truelockmc/streambert/releases)
[![Issues Badge](https://img.shields.io/github/issues/truelockmc/streambert?style=for-the-badge)](https://github.com/truelockmc/streambert/issues)
[![Closed Issues Badge](https://img.shields.io/github/issues-closed/truelockmc/streambert?color=%238256d0&style=for-the-badge)](https://github.com/truelockmc/streambert/issues?q=is%3Aissue+is%3Aclosed)<br>

# Streambert
A cross-platform Electron Desktop App to stream and download any Movie, TV Series or Anime in the World. Zero Ads and Tracking <br></br>
![Logo](public/logo.svg)

## Why Streambert?
- 🎦 **Streaming:** Stream any Movie, Anime or TV Series from around the World.
- 📥 **Downloading:** Download anything you want to watch (with Subtitles).
- ⚙️ **Customizability:** Customize the Interface and Features to your unique needs.
- 📚 **Library:** Track what you watched, save stuff you want to watch and manage your Downloads.
- ✨ **Trending:** Discover new things to Watch every Day.
- 🛡️ **Privacy:** Completely Ads and Tracker free, forever.
- ⚡ **Speed:** Stream faster than any Browser can, download with multithreading.

![Explore new Stuff](screenshots/trending.png)
![Watch TV Series](screenshots/series.png)
![Watch Movies](screenshots/movie.png)
![Watch Anime](screenshots/anime.png)
![Without any Ads or Trackers](screenshots/adblock.png)
![Download Everything](screenshots/download.png)
---
[![Stargazers](https://reporoster.com/stars/dark/truelockmc/streambert)](https://github.com/truelockmc/streambert/stargazers)
---
## Streaming
The Application mainly gets Video Streams from videasy.net (you can also Stream from VidScr and 2Embed). <br></br>
It fetches Information for Images, Info Texts, Search and Homepage from [tmdb](https://www.themoviedb.org/).

---

## Downloading
You can download those Video Streams because the Program sources Links to their .m3u8 Playlist Files ([similar to this Browser Extension](https://addons.mozilla.org/en-US/firefox/addon/m3u8-link-finder/)). <br></br>
Once you click 'Download' these Links are used to download the Full Movie/TV Episode using [this Program](https://github.com/truelockmc/video-downloader). You can then watch them In-App or take the Files on any Storage Medium you want.

---

## Anime
You can also watch Anime, the App checks if a Movie or Series is an Anime and then sources its Metadata from [AniList](https://anilist.co/) instead of [tmdb](https://www.themoviedb.org/). <br></br>
Media Files for Animes are scraped from AllManga.to (i stole this mechanic from [ani-cli](https://github.com/pystardust/ani-cli)). The App directly gets .mp4 Files and doesnt evem show you the AllManga website, you can also download these Files, just like any other Content.


## Requirements

- [Node.js](https://nodejs.org/) (>=22.12.0) installed (only if you aren't using [prebuilt Binaries](https://github.com/truelockmc/streambert/releases/latest))
- A free [TMDB API Read Access Token](https://www.themoviedb.org/settings/api)
- For downloading, [this Program](https://github.com/truelockmc/video-downloader/releases/latest) somewhere on your PC and [ffmpeg](https://ffmpeg.org/download.html) installed

---

## Setup & Run
Option 1: 
Use a prebuilt Binary from [Releases](https://github.com/truelockmc/streambert/releases/latest)

Option 2:
Use the Source Code
```bash
# 1. Open a terminal in the Code Folder, then install dependencies:
npm install

# 2. Start the dev server:
npm start

```

On first launch you'll be prompted to enter your TMDB API key. It's saved locally, you only need to do this once.

---


## Build from Source

```bash
npm run dist:win
```
or
```bash
npm run dist:linux
```

---
## Project Structure
```
Project Root
├── index.html
├── main.js
├── package.json
├── preload.js
├── vite.config.js
├── LICENSE
├── README.md
├── public
│   ├── icon.png
│   └── logo.svg
├── screenshots
│   ├── adblock.png
│   ├── anime.png
│   ├── download.png
│   ├── icon.png
│   ├── movie.png
│   ├── series.png
│   └── trending.png
└── src
    ├── App.jsx
    ├── main.jsx
    ├── components
    │   ├── BlockedStatsModal.jsx
    │   ├── CloseConfirmModal.jsx
    │   ├── DownloadModal.jsx
    │   ├── Icons.jsx
    │   ├── MediaCard.jsx
    │   ├── SearchModal.jsx
    │   ├── SetupScreen.jsx
    │   ├── Sidebar.jsx
    │   ├── TrailerModal.jsx
    │   └── TrendingCarousel.jsx
    ├── pages
    │   ├── DownloadsPage.jsx
    │   ├── HomePage.jsx
    │   ├── LibraryPage.jsx
    │   ├── MoviePage.jsx
    │   ├── SettingsPage.jsx
    │   └── TVPage.jsx
    ├── styles
    │   ├── global.css
    │   └── fonts
    │       ├── bebas-neue-regular.woff2
    │       ├── dm-sans-300.woff2
    │       ├── dm-sans-300italic.woff2
    │       ├── dm-sans-500.woff2
    │       ├── dm-sans-600.woff2
    │       └── dm-sans-regular.woff2
    └── utils
        ├── ageRating.js
        ├── api.js
        ├── storage.js
        ├── useBlockedStats.js
        └── useRatings.js
```
