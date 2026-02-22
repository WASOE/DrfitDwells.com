# Extract Still Image from Video

To create the poster image for `The-cabin-header.mp4`, extract the first frame:

## Using ffmpeg (recommended):
```bash
ffmpeg -i uploads/Videos/The-cabin-header.mp4 -ss 00:00:00 -vframes 1 -q:v 2 uploads/Videos/The-cabin-header-poster.jpg
```

## Using VLC:
1. Open the video in VLC
2. Go to Video → Snapshot
3. Save as `The-cabin-header-poster.jpg` in `uploads/Videos/`

## Using online tools:
- Upload the video to an online video frame extractor
- Extract frame at 0:00
- Save as `The-cabin-header-poster.jpg`

The file should be saved at: `uploads/Videos/The-cabin-header-poster.jpg`




























