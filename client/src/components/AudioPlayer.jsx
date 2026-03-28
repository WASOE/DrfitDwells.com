import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Volume2, VolumeX, AlertCircle } from 'lucide-react';
import { locations } from '../data/content';
import { useFloatingSafeArea } from '../hooks/useFloatingSafeArea';

function AudioPlayer() {
  const location = useLocation();
  const { bottomOffset, isDesktop } = useFloatingSafeArea();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef(null);
  const errorHandledRef = useRef(false);

  const getAudioSrc = useCallback(() => {
    if (location.pathname.includes('/valley')) {
      return locations.find((loc) => loc.id === 'valley')?.audioSrc || '/audio/lit-fireplace-6307.mp3';
    }
    return locations.find((loc) => loc.id === 'cabin')?.audioSrc || '/audio/Soyb - Mood (freetouse.com).mp3';
  }, [location.pathname]);

  const destroyAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = '';
    audioRef.current = null;
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    setIsLoading(false);
    setHasError(false);
    errorHandledRef.current = false;
    destroyAudio();
  }, [location.pathname, destroyAudio]);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;

    const audioSrc = getAudioSrc();
    const audio = new Audio(audioSrc);
    audio.loop = true;
    audio.volume = 0.4;
    audio.preload = 'none';

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setHasError(false);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleError = () => {
      if (errorHandledRef.current) return;
      errorHandledRef.current = true;
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(true);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
    };

    const handleCanPlayThrough = () => {
      setIsLoading(false);
      setHasError(false);
    };

    const handleLoadedData = () => {
      setIsLoading(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplaythrough', handleCanPlayThrough);
    audio.addEventListener('loadeddata', handleLoadedData);

    audioRef.current = audio;
    return audio;
  }, [getAudioSrc]);

  const toggleAudio = async () => {
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    try {
      setIsLoading(true);
      setHasError(false);
      errorHandledRef.current = false;

      const audio = ensureAudio();

      if (audio.error) {
        const errorMsg = audio.error.message || `Error code: ${audio.error.code}`;
        throw new Error(`Audio file error: ${errorMsg}. Please ensure ${getAudioSrc()} is a valid MP3 file.`);
      }

      if (audio.readyState < 2) {
        audio.load();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            audio.removeEventListener('canplay', handleCanPlay);
            audio.removeEventListener('error', handleErr);
            reject(new Error('Audio load timeout'));
          }, 5000);

          const handleCanPlay = () => {
            clearTimeout(timeout);
            audio.removeEventListener('canplay', handleCanPlay);
            audio.removeEventListener('error', handleErr);
            resolve();
          };

          const handleErr = () => {
            clearTimeout(timeout);
            audio.removeEventListener('canplay', handleCanPlay);
            audio.removeEventListener('error', handleErr);
            reject(new Error(audio.error?.message || 'Audio failed to load'));
          };

          audio.addEventListener('canplay', handleCanPlay);
          audio.addEventListener('error', handleErr);
        });
      }

      if (audio.error) {
        throw new Error(`Audio file is invalid: ${getAudioSrc()}`);
      }

      const playPromise = audio.play();
      if (playPromise !== undefined) await playPromise;

      await new Promise((resolve) => setTimeout(resolve, 100));

      if (audio.paused) {
        throw new Error('Audio failed to start playing');
      }

      setIsPlaying(true);
      setIsLoading(false);
      setHasError(false);
    } catch {
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(true);
    }
  };

  if (hasError) {
    return (
      <div
        className="fixed top-20 right-4 md:left-6 md:top-auto md:right-auto z-[60]"
        style={isDesktop ? { bottom: `${bottomOffset}px` } : undefined}
      >
        <button
          type="button"
          onClick={toggleAudio}
          disabled={true}
          className="w-12 h-12 md:w-auto md:h-auto md:px-4 md:py-2 rounded-full bg-red-900/90 md:bg-red-900/80 backdrop-blur-md text-white flex items-center justify-center gap-3 cursor-not-allowed shadow-lg border border-red-500/50 opacity-75"
          aria-label="Audio file error - file needs to be replaced"
          title={`Audio file error: ${getAudioSrc()} is not a valid MP3 file. Please replace it with a valid audio file.`}
        >
          <AlertCircle className="w-5 h-5 md:w-4 md:h-4" />
          <span className="hidden md:inline text-xs uppercase tracking-widest">File Error</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleAudio}
      disabled={isLoading}
      className="fixed top-20 right-4 md:left-6 md:top-auto md:right-auto z-[60] w-12 h-12 md:w-auto md:h-auto md:px-4 md:py-2 rounded-full bg-stone-900/90 md:bg-stone-900/80 backdrop-blur-md text-white flex items-center justify-center gap-3 cursor-pointer hover:bg-black transition-colors touch-manipulation shadow-lg border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        ...(isDesktop ? { bottom: `${bottomOffset}px` } : {}),
        pointerEvents: 'auto'
      }}
      aria-label={isPlaying ? 'Turn sound off' : 'Turn sound on'}
    >
      {isLoading ? (
        <>
          <div className="w-5 h-5 md:w-4 md:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="hidden md:inline text-xs uppercase tracking-widest">Loading...</span>
        </>
      ) : isPlaying ? (
        <>
          <Volume2 className="w-5 h-5 md:w-4 md:h-4" />
          <span className="hidden md:inline text-xs uppercase tracking-widest">Sound On</span>
          <span className="hidden md:inline w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </>
      ) : (
        <>
          <VolumeX className="w-5 h-5 md:w-4 md:h-4" />
          <span className="hidden md:inline text-xs uppercase tracking-widest">Sound Off</span>
        </>
      )}
    </button>
  );
}

export default AudioPlayer;
