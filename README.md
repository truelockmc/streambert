# Streambert
A cross-platform Electron Desktop App to stream and download any Movie or TV Series in the World. <br></br>
![Logo](public/logo.svg)

![Watch TV Series](screenshots/series.png)
![Download Everything](screenshots/download.png)
---

## Requirements

- [Node.js](https://nodejs.org/) (>=22.12.0) installed
- A free [TMDB API key](https://www.themoviedb.org/settings/api)
- For downloading, [this Program](https://github.com/truelockmc/video-downloader/releases/latest) somewhere on your PC and [ffmpeg](https://ffmpeg.org/download.html) installed

---

## Streaming
The Application gets Video Streams from videasy.net (more Providers will follow). <br></br>
It fetches Information for Images, Info Texts, Search and Homepage from [tmdb](https://www.themoviedb.org/).

## Downloading
You can download those Video Streams because the Program sources Links to their .m3u8 Playlist Files ([similar to this Browser Extension](https://addons.mozilla.org/en-US/firefox/addon/m3u8-link-finder/)). <br></br>
Once you click 'Download' these Links are used to download the Full Movie/TV Episode using [this Program](https://github.com/truelockmc/video-downloader). You can then watch them In-App or take the Files on any Storage Medium you want.

## Setup & Run

```bash
# 1. Open a terminal in the Code Folder, then install dependencies:
npm install

# 2. Start the dev server:
npm start

```

On first launch you'll be prompted to enter your TMDB API key. It's saved locally, you only need to do this once.

---

## Build for Production

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
├── package-lock.json
├── preload.js
├── public
│   └── logo.svg
├── README.md
├── screenshots
│   ├── download.png
│   └── series.png
├── src
│   ├── App.jsx
│   ├── components
│   │   ├── DownloadModal.jsx
│   │   ├── Icons.jsx
│   │   ├── MediaCard.jsx
│   │   ├── SearchModal.jsx
│   │   ├── SetupScreen.jsx
│   │   └── Sidebar.jsx
│   ├── main.jsx
│   ├── pages
│   │   ├── DownloadsPage.jsx
│   │   ├── HomePage.jsx
│   │   ├── LibraryPage.jsx
│   │   ├── MoviePage.jsx
│   │   ├── SettingsPage.jsx
│   │   └── TVPage.jsx
│   ├── styles
│   │   └── global.css
│   └── utils
│       ├── api.js
│       └── storage.js
└── vite.config.js
```
