#!/usr/bin/env node
/**
 * Extract the first frame of each hero video as a poster image (JPG).
 * Poster paths match client/src/config/mediaConfig.js.
 * Uses ffmpeg-static from project devDependencies.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VIDEOS_DIR = resolve(ROOT, 'uploads', 'Videos');
const FFMPEG = ffmpegStatic || 'ffmpeg';

const VIDEO_TO_POSTER = [
  ['The-cabin-header.winter.mp4', 'The-cabin-header.winter-poster.jpg'],
  ['The-cabin-header.summer.mp4', 'The-cabin-header.summer-poster.jpg'],
  ['The-Valley-firaplace-video.winter.mp4', 'The-Valley-firaplace-video.winter-poster.jpg'],
  ['The-Valley-firaplace-video.mp4', 'The-Valley-firaplace-video-poster.jpg'],
  ['The-Valley-Night-Stars.mp4', 'The-Valley-Night-Stars-poster.jpg'],
];

function extractFrame(videoPath, posterPath) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      FFMPEG,
      ['-y', '-i', videoPath, '-vframes', '1', '-q:v', '2', posterPath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

async function main() {
  for (const [videoName, posterName] of VIDEO_TO_POSTER) {
    const videoPath = resolve(VIDEOS_DIR, videoName);
    const posterPath = resolve(VIDEOS_DIR, posterName);
    if (!existsSync(videoPath)) {
      console.warn(`Skip (video missing): ${videoName}`);
      continue;
    }
    try {
      await extractFrame(videoPath, posterPath);
      console.log(`${videoName} → ${posterName}`);
    } catch (e) {
      console.error(`Failed ${videoName}:`, e.message);
      process.exitCode = 1;
    }
  }
}

main();
