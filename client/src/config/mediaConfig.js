// Canonical media configuration for hero videos, posters and SEO images.
// All components should import from here instead of hardcoding `/uploads/...` paths.

export const CABIN_MEDIA = {
  heroVideo: {
    winter: '/uploads/Videos/The-cabin-header.winter.mp4',
    summer: '/uploads/Videos/The-cabin-header.summer.mp4'
  },
  heroPoster: {
    // Distinct seasonal posters – see EXTRACT_VIDEO_FRAME.md
    winter: '/uploads/Videos/The-cabin-header.winter-poster.jpg',
    summer: '/uploads/Videos/The-cabin-header.summer-poster.jpg'
  },
  seoOgImage: '/uploads/Videos/The-cabin-header.winter-poster.jpg'
};

export const VALLEY_MEDIA = {
  heroVideo: {
    winter: '/uploads/Videos/The-Valley-firaplace-video.winter.mp4',
    // Primary summer hero video for most pages
    summer: '/uploads/Videos/The-Valley-firaplace-video.mp4'
  },
  heroPoster: {
    winter: '/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg',
    summer: '/uploads/Videos/The-Valley-firaplace-video-poster.jpg'
  },
  // Alternate cinematic pair used on the home hero (DualityHero) for summer valley pane
  altSummerPair: {
    video: '/uploads/Videos/The-Valley-Night-Stars.mp4',
    poster: '/uploads/Videos/The-Valley-Night-Stars-poster.jpg'
  },
  seoOgImage: '/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg'
};

