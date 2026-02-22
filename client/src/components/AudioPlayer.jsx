import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Volume2, VolumeX, AlertCircle } from 'lucide-react';
import { locations } from '../data/content';

function AudioPlayer() {
  const location = useLocation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef(null);
  const errorHandledRef = useRef(false);

  // Determine which audio file to use based on current route
  const getAudioSrc = () => {
    if (location.pathname.includes('/valley')) {
      return locations.find(loc => loc.id === 'valley')?.audioSrc || '/audio/lit-fireplace-6307.mp3';
    }
    // Default to cabin audio (for /cabin or home page)
    return locations.find(loc => loc.id === 'cabin')?.audioSrc || '/audio/Soyb - Mood (freetouse.com).mp3';
  };

  useEffect(() => {
    // Reset state when route changes
    setIsPlaying(false);
    setIsLoading(false);
    setHasError(false);
    errorHandledRef.current = false;
    
    // Stop and clean up previous audio if it exists
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    
    // Initialize audio element with location-specific audio
    const audioSrc = getAudioSrc();
    console.log('AudioPlayer: Loading audio for route', location.pathname, '->', audioSrc);
    const audio = new Audio(audioSrc);
    audio.loop = true;
    audio.volume = 0.4;
    audio.preload = 'auto';
    
    // Set up event listeners for state synchronization
    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setHasError(false);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleError = (e) => {
      if (errorHandledRef.current) return; // Prevent duplicate error handling
      errorHandledRef.current = true;
      
      console.error('Audio error:', e);
      const errorDetails = {
        error: audio.error,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: audio.src
      };
      console.error('Audio error details:', errorDetails);
      
      // networkState: 0=EMPTY, 1=IDLE, 2=LOADING, 3=NO_SOURCE, 4=FORMAT_ERROR
      // readyState: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
      if (audio.networkState === 3 || audio.networkState === 4) {
        console.error('Audio file failed to load - file may be missing, corrupted, or invalid format');
      }
      
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(true);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
      // Don't reset error here - let error handler manage error state
      // setHasError(false);
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

    // Store audio reference
    audioRef.current = audio;

    // Check for immediate errors - only check for actual errors, not loading states
    // networkState: 0=EMPTY, 1=IDLE, 2=LOADING, 3=NO_SOURCE, 4=FORMAT_ERROR
    // Only trigger on actual errors: networkState === 3 (NO_SOURCE) or networkState === 4 (FORMAT_ERROR)
    // Don't trigger on networkState === 2 (LOADING) as that's normal
    const checkError1 = setTimeout(() => {
      if (!errorHandledRef.current && (audio.error || audio.networkState === 3 || audio.networkState === 4)) {
        console.error('Audio has immediate error (check 1):', {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState
        });
        handleError({ target: audio });
      }
    }, 500);

    const checkError2 = setTimeout(() => {
      if (!errorHandledRef.current && (audio.error || audio.networkState === 3 || audio.networkState === 4)) {
        console.error('Audio has immediate error (check 2):', {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState
        });
        handleError({ target: audio });
      }
    }, 1500);

    const checkError3 = setTimeout(() => {
      if (!errorHandledRef.current && (audio.error || audio.networkState === 3 || audio.networkState === 4)) {
        console.error('Audio has immediate error (check 3):', {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState
        });
        handleError({ target: audio });
      }
    }, 3000);

    return () => {
      clearTimeout(checkError1);
      clearTimeout(checkError2);
      clearTimeout(checkError3);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
      errorHandledRef.current = false;
    };
  }, [location.pathname]);

  const toggleAudio = async () => {
    if (!audioRef.current) {
      console.error('Audio ref is null');
      return;
    }

    const audio = audioRef.current;

    if (isPlaying) {
      // Pause audio
      audio.pause();
      setIsPlaying(false);
    } else {
      // Play audio
      try {
        setIsLoading(true);
        setHasError(false);
        
        // Check for errors before attempting to play
        if (audio.error) {
          const errorMsg = audio.error.message || `Error code: ${audio.error.code}`;
          const currentSrc = audio.src || getAudioSrc();
          throw new Error(`Audio file error: ${errorMsg}. Please ensure ${currentSrc} is a valid MP3 file.`);
        }
        
        // Check if audio needs to be loaded
        // readyState: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
        if (audio.readyState < 2) {
          audio.load();
          
          // Wait for audio to be ready to play
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              audio.removeEventListener('canplay', handleCanPlay);
              audio.removeEventListener('error', handleError);
              reject(new Error('Audio load timeout - file may be corrupted or inaccessible'));
            }, 5000);
            
            // Define handlers BEFORE setTimeout cleanup
            const handleCanPlay = () => {
              clearTimeout(timeout);
              audio.removeEventListener('canplay', handleCanPlay);
              audio.removeEventListener('error', handleError);
              resolve();
            };
            
            const handleError = (e) => {
              clearTimeout(timeout);
              audio.removeEventListener('canplay', handleCanPlay);
              audio.removeEventListener('error', handleError);
              reject(new Error(`Audio failed to load: ${audio.error?.message || 'Unknown error'}`));
            };
            
            audio.addEventListener('canplay', handleCanPlay);
            audio.addEventListener('error', handleError);
          });
        }
        
        // Check for errors again after loading
        if (audio.error) {
          const errorMsg = audio.error.message || `Error code: ${audio.error.code}`;
          const currentSrc = audio.src || getAudioSrc();
          throw new Error(`Audio file is invalid: ${errorMsg}. The file at ${currentSrc} must be a valid MP3 file.`);
        }
        
        // Attempt to play audio
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
        
        // Verify audio is actually playing
        // Small delay to allow browser to start playback
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (audio.paused) {
          // Audio didn't start playing
          throw new Error('Audio failed to start playing - browser may have blocked autoplay or file is invalid');
        }
        
        // Success - state will be updated by handlePlay event listener
        // But also set manually as immediate feedback
        setIsPlaying(true);
        setIsLoading(false);
        setHasError(false);
        
      } catch (error) {
        console.error('Unable to start audio:', error);
        setIsLoading(false);
        setIsPlaying(false);
        setHasError(true);
      }
    }
  };

  // If there's an error, show a warning but still allow interaction
  if (hasError) {
    return (
      <div className="fixed top-20 right-4 md:bottom-6 md:left-6 md:top-auto md:right-auto z-[60]">
        <button
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
      onClick={toggleAudio}
      disabled={isLoading}
      className="fixed top-20 right-4 md:bottom-6 md:left-6 md:top-auto md:right-auto z-[60] w-12 h-12 md:w-auto md:h-auto md:px-4 md:py-2 rounded-full bg-stone-900/90 md:bg-stone-900/80 backdrop-blur-md text-white flex items-center justify-center gap-3 cursor-pointer hover:bg-black transition-colors touch-manipulation shadow-lg border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label={isPlaying ? 'Turn sound off' : 'Turn sound on'}
      style={{ pointerEvents: 'auto' }}
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
