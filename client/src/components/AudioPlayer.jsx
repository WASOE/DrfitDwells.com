import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const AudioPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    audioRef.current = new Audio('https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3');
    audioRef.current.loop = true;
    audioRef.current.volume = 0.4;

    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const toggleAudio = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        console.error('Unable to start audio', error);
      }
    }
  };

  return (
    <button
      onClick={toggleAudio}
      className="fixed bottom-8 left-8 z-50 bg-stone-900/80 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-3 cursor-pointer hover:bg-black transition-colors"
      aria-label={isPlaying ? 'Turn sound off' : 'Turn sound on'}
    >
      {isPlaying ? (
        <>
          <Volume2 className="w-4 h-4" />
          <span className="text-xs uppercase tracking-widest">Sound On</span>
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </>
      ) : (
        <>
          <VolumeX className="w-4 h-4" />
          <span className="text-xs uppercase tracking-widest">Sound Off</span>
        </>
      )}
    </button>
  );
};

export default AudioPlayer;


