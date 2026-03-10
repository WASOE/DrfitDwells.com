# Extract Still Images from Videos (First-Frame Posters)

Poster images are shown while videos load (lazy-load pattern). When you change hero/cabin/valley videos, extract new first frames with ffmpeg.

## Prerequisites

Install ffmpeg:

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

## Commands

Run from project root. `-ss 00:00:00 -vframes 1 -q:v 2` extracts the first frame at high quality.

### Cabin (Home + The Cabin page)

```bash
ffmpeg -i uploads/Videos/The-cabin-header.winter.mp4 -ss 00:00:00 -vframes 1 -q:v 2 uploads/Videos/The-cabin-header.winter-poster.jpg -y
ffmpeg -i uploads/Videos/The-cabin-header.summer.mp4 -ss 00:00:00 -vframes 1 -q:v 2 uploads/Videos/The-cabin-header.summer-poster.jpg -y
```

### Valley (Home + The Valley page)

```bash
ffmpeg -i uploads/Videos/The-Valley-firaplace-video.winter.mp4 -ss 00:00:00 -vframes 1 -q:v 2 uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg -y
ffmpeg -i uploads/Videos/The-Valley-firaplace-video.mp4 -ss 00:00:00 -vframes 1 -q:v 2 uploads/Videos/The-Valley-firaplace-video-poster.jpg -y
ffmpeg -i uploads/Videos/The-Valley-Night-Stars.mp4 -ss 00:00:00 -vframes 1 -q:v 2 uploads/Videos/The-Valley-Night-Stars-poster.jpg -y
```

### One-liner (all posters)

```bash
cd uploads/Videos && \
ffmpeg -i The-cabin-header.winter.mp4 -ss 00:00:00 -vframes 1 -q:v 2 The-cabin-header.winter-poster.jpg -y && \
ffmpeg -i The-cabin-header.summer.mp4 -ss 00:00:00 -vframes 1 -q:v 2 The-cabin-header.summer-poster.jpg -y && \
ffmpeg -i The-Valley-firaplace-video.winter.mp4 -ss 00:00:00 -vframes 1 -q:v 2 The-Valley-firaplace-video.winter-poster.jpg -y && \
ffmpeg -i The-Valley-firaplace-video.mp4 -ss 00:00:00 -vframes 1 -q:v 2 The-Valley-firaplace-video-poster.jpg -y && \
ffmpeg -i The-Valley-Night-Stars.mp4 -ss 00:00:00 -vframes 1 -q:v 2 The-Valley-Night-Stars-poster.jpg -y
```

## Where each poster is used

| Poster | Video | Used in |
|--------|-------|---------|
| The-cabin-header.winter-poster.jpg | The-cabin-header.winter.mp4 | Home (DualityHero), The Cabin, DestinationsFooter, ogImage |
| The-cabin-header.summer-poster.jpg | The-cabin-header.summer.mp4 | Home (DualityHero), The Cabin |
| The-Valley-firaplace-video.winter-poster.jpg | The-Valley-firaplace-video.winter.mp4 | Home (DualityHero), Valley pages, DestinationsFooter, ogImage |
| The-Valley-firaplace-video-poster.jpg | The-Valley-firaplace-video.mp4 | Valley summer (TheValley, TheValleyPage) |
| The-Valley-Night-Stars-poster.jpg | The-Valley-Night-Stars.mp4 | Home (DualityHero) valley summer |
