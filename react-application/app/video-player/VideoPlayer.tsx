import React, { useRef, useState, useEffect, forwardRef } from "react";

interface VideoPlayerProps {
  src: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  style?: React.CSSProperties;
  playbackRate: number;
  onPlaybackRateChange?: (rate: number) => void;
  freezePlaybackRate?: boolean;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${m}:${s}:${ms}`;
};

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, videoRef, style, playbackRate, onPlaybackRateChange, freezePlaybackRate = false }) => {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // const [playbackRate, setPlaybackRate] = useState(1); // This state is now a prop
  const [mirrored, setMirrored] = useState(false);

  // Sync state with video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    // Cleanup
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoRef]);

  // Update playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, videoRef]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const time = parseFloat(e.target.value);
    video.currentTime = time;
    setCurrentTime(time);
  };

  const handleSpeed = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (freezePlaybackRate) return;
    const newRate = parseFloat(e.target.value);
    if (onPlaybackRateChange) {
      onPlaybackRateChange(newRate);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '80%', maxWidth: '100%', maxHeight: '80%', ...style }}>
      <video
        ref={videoRef}
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          transform: mirrored ? 'scaleX(-1)' : 'scaleX(1)',
          transformOrigin: 'center',
        }}
        controls={false}
      />
      <button
        onClick={() => setMirrored(m => !m)}
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          padding: '6px 12px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: '#6c757d',
          color: '#fff',
          zIndex: 2,
        }}
      >
        Toggle Mirror
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button
          onClick={togglePlay}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            backgroundColor: playing ? '#dc3545' : '#28a745',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            // Pause icon
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="3" width="4" height="14" rx="1" fill="#fff" />
              <rect x="12" y="3" width="4" height="14" rx="1" fill="#fff" />
            </svg>
          ) : (
            // Play icon
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="5,3 17,10 5,17" fill="#fff" />
            </svg>
          )}
        </button>
        <span style={{ minWidth: 70, fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={handleSeek}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, opacity: freezePlaybackRate ? 0.5 : 1 }}>
        <label htmlFor="speed-slider">Speed:</label>
        <input
          id="speed-slider"
          type="range"
          min={0.25}
          max={2}
          step={0.25}
          value={playbackRate}
          onChange={handleSpeed}
          style={{ flex: 1 }}
          disabled={freezePlaybackRate}
        />
        <span>{playbackRate.toFixed(2)}x</span>
      </div>
    </div>
  );
};

export default VideoPlayer;
