import React, { useState, useRef, useEffect } from "react";
import SkeletonViewer from "./skeleton-viewer"; // Adjust path as needed
import * as poseDetection from '@tensorflow-models/pose-detection';
import type { LevelData, TimestampedPoses } from "~/api/endpoints";
import endpoints from "~/api/endpoints";
import { SessionScorer } from "./utils";

const FEED_SIZE = 500; // Square size in pixels

export default function PoseComparisonPage() {
  const [webcamPose, setWebcamPose] = useState<TimestampedPoses[]>([]);
  const [videoURL, setVideoURL] = useState<string | null>(null);
  const [levelData, setLevelData] = useState<LevelData | null>(null);
  const [objectId, setObjectId] = useState("");
  const [annotatedVideoUrl, setAnnotatedVideoUrl] = useState<string | null>(null);
  const scorerRef = useRef<SessionScorer | null>(null);
  const [windowScore, setWindowScore] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeUpdateListenerRef = useRef<((this: HTMLVideoElement, ev: Event) => any) | null>(null);
  // Interval interaction state
  const [activeIntervalIndex, setActiveIntervalIndex] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<"preview" | "try" | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [afterInterval, setAfterInterval] = useState<boolean>(false);
  // custom interval selection
  const [customStart, setCustomStart] = useState<number | null>(null);
  const [customEnd, setCustomEnd] = useState<number | null>(null);
  // Ref to keep latest interactionMode value inside callbacks
  const interactionModeRef = useRef<"preview" | "try" | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  // Function to handle webcam pose reporting
  const handleWebcamPose = (data: TimestampedPoses) => {
    data.timestamp = (videoRef.current?.currentTime ?? 0) * 1000;
    setWebcamPose(prev => [...prev, data]);
    if (scorerRef.current && interactionModeRef.current === "try") {
      const score = scorerRef.current.consumePose(data);
      if (typeof score === "number") {
        setWindowScore(score);
      }
    }
  };

  const handleFetch = async () => {
    if (!objectId) return;
    try {
      const [videoUrl, level] = await Promise.all([
        endpoints.getAnnotatedVideo(objectId),
        endpoints.getLevel(objectId),
      ]);
      setAnnotatedVideoUrl(videoUrl);
      setLevelData(level);
      scorerRef.current = new SessionScorer(level, 500, level.intervals.map(interval => [interval[0], interval[1]]));
    } catch (err) {
      alert("Failed to fetch video or level data");
      console.error(err);
    }
  };

  // Helper to actually play an arbitrary segment
  const playSegment = (startMs: number, endMs: number) => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    // Remove any previous listener
    if (timeUpdateListenerRef.current) {
      video.removeEventListener("timeupdate", timeUpdateListenerRef.current);
    }

    // Seek and play
    video.currentTime = startMs / 1000;

    const handleTimeUpdate = () => {
      if (video.currentTime * 1000 >= endMs) {
        video.pause();
        if (timeUpdateListenerRef.current) {
          video.removeEventListener("timeupdate", timeUpdateListenerRef.current);
          timeUpdateListenerRef.current = null;
        }
        handleIntervalEnd();
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    timeUpdateListenerRef.current = handleTimeUpdate;

    // Start playback (ensure play even if already playing to reset)
    video.play();
  };

  // Existing helper: play segment by interval index
  const startVideoSegment = (intervalIdx: number) => {
    if (!levelData) return;
    const [startMs, endMs] = levelData.intervals[intervalIdx];
    playSegment(startMs, endMs);
  };

  // Called whenever an interval finishes (preview or try)
  const handleIntervalEnd = () => {
    if (interactionMode === "try") {
      // Compile session data
      const sessionSummary = {
        poses: webcamPose,
        intervalScores: scorerRef.current?.computeIntervalScores() ?? [],
        beginTimestamp: activeIntervalIndex !== null ? levelData?.intervals[activeIntervalIndex][0] : customStart,
        endTimestamp: activeIntervalIndex !== null ? levelData?.intervals[activeIntervalIndex][1] : customEnd,
        custom: customStart !== null && customEnd !== null && customStart < customEnd,
      };
      console.log("Session Summary", sessionSummary);
    }

    // Show post-interval options
    setAfterInterval(true);
    setCountdown(null);
    setInteractionMode(null);
  };

  // Preview button handler
  const previewInterval = (idx: number) => {
    setActiveIntervalIndex(idx);
    setInteractionMode("preview");
    setAfterInterval(false);
    startVideoSegment(idx);
  };

  // Try It button handler
  const tryInterval = (idx: number) => {
    if (!levelData) return;
    setActiveIntervalIndex(idx);
    setInteractionMode("try");
    setAfterInterval(false);

    // Reset webcam poses and scorer
    setWebcamPose([]);
    scorerRef.current = new SessionScorer(levelData, 500, levelData.intervals.map(interval => [interval[0], interval[1]]));

    // Start countdown
    setCountdown(3);
  };

  // Cancel and return to full video view
  const cancelInterval = () => {
    setActiveIntervalIndex(null);
    setAfterInterval(false);
    setInteractionMode(null);
    setCountdown(null);
    setCustomStart(null);
    setCustomEnd(null);
    // Allow user to control full video again
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      // Countdown finished – start segment playback
      if (activeIntervalIndex !== null) {
        startVideoSegment(activeIntervalIndex);
      } else if (customStart !== null && customEnd !== null && customStart < customEnd) {
        playSegment(customStart, customEnd);
      }
      // Hide overlay
      setCountdown(null);
      return;
    }

    const timer = setTimeout(() => setCountdown(prev => (prev !== null ? prev - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // -------- Custom Interval helpers --------
  const markCustomStart = () => {
    if (!videoRef.current) return;
    setCustomStart(videoRef.current.currentTime * 1000);
  };

  const markCustomEnd = () => {
    if (!videoRef.current) return;
    setCustomEnd(videoRef.current.currentTime * 1000);
  };

  const previewCustom = () => {
    if (customStart === null || customEnd === null || customStart >= customEnd) return;
    setActiveIntervalIndex(null);
    setInteractionMode("preview");
    setAfterInterval(false);
    playSegment(customStart, customEnd);
  };

  const tryCustom = () => {
    if (!levelData || customStart === null || customEnd === null || customStart >= customEnd) return;
    setActiveIntervalIndex(null);
    setInteractionMode("try");
    setAfterInterval(false);

    setWebcamPose([]);
    scorerRef.current = new SessionScorer(levelData, 500, [[customStart, customEnd]]);

    setCountdown(3);
  };

  const feedContainerStyle = {
    width: FEED_SIZE,
    height: FEED_SIZE,
    backgroundColor: "#f0f0f0",
    borderRadius: "8px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
  };

  const feedStyle = {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
  };

  return (
    <div style={{ padding: "2rem" }}>
      {/* Interval Control Panel */}
      {levelData && (
        <div style={{
          marginBottom: "2rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}>
          {levelData.intervals.map((_, idx) => (
            <div key={idx} style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}>
              <span style={{ fontWeight: "bold", color: "white" }}>Interval #{idx + 1}</span>
              <button
                onClick={() => previewInterval(idx)}
                style={{ padding: "4px 12px", borderRadius: "4px", border: "none", backgroundColor: "#6c757d", color: "#fff" }}
              >
                Preview
              </button>
              <button
                onClick={() => tryInterval(idx)}
                style={{ padding: "4px 12px", borderRadius: "4px", border: "none", backgroundColor: "#28a745", color: "#fff" }}
              >
                Try It
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        gap: "2rem",
        flexWrap: "wrap" as const,
      }}>
        <div>
          <h2 style={{ marginBottom: "1rem", textAlign: "center" as const }}>Webcam</h2>
          <div style={feedContainerStyle}>
            <SkeletonViewer
              reportPoses={handleWebcamPose}
              useWebcam={true}
              mediaStream={null}
              width={FEED_SIZE}
              height={FEED_SIZE}
            />
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: "1rem", textAlign: "center" as const }}>Video</h2>
          <div style={{ marginBottom: "1rem", textAlign: "center" as const }}>
            <input
              type="text"
              placeholder="Paste Object ID"
              value={objectId}
              onChange={e => setObjectId(e.target.value)}
              style={{ 
                width: "70%", 
                marginRight: "8px",
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ccc"
              }}
            />
            <button 
              onClick={handleFetch}
              style={{
                padding: "8px 16px",
                borderRadius: "4px",
                border: "none",
                backgroundColor: "#007bff",
                color: "white",
                cursor: "pointer"
              }}
            >
              Load Video
            </button>
          </div>
          <div style={feedContainerStyle}>
            {annotatedVideoUrl ? (
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <video 
                  src={annotatedVideoUrl} 
                  controls 
                  style={feedStyle}
                  ref={videoRef}
                />
                {/* Countdown Overlay */}
                {countdown !== null && (
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(0,0,0,0.5)",
                    fontSize: "5rem",
                    color: "#fff",
                    pointerEvents: "none",
                  }}>
                    {countdown}
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#666"
              }}>
                No video loaded
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Score Display */}
      <div style={{
        marginTop: "1.5rem",
        width: "100%",
        backgroundColor: "#000",
        padding: "1rem 0",
        textAlign: "center" as const,
      }}>
        <span style={{
          color: "#fff",
          fontSize: "3rem",
          fontWeight: "bold" as const,
        }}>
          {windowScore !== null ? windowScore.toFixed(2) : "--"}
        </span>
      </div>

      {/* Custom Interval Selection */}
      {annotatedVideoUrl && (
        <div style={{
          marginBottom: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          alignItems: "center",
        }}>
          <h3 style={{ margin: 0 }}>Custom Interval</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button onClick={markCustomStart} style={{ padding: "4px 8px" }}>Mark Start</button>
            <span>{customStart !== null ? (customStart/1000).toFixed(2) + "s" : "--"}</span>
            <button onClick={markCustomEnd} style={{ padding: "4px 8px" }}>Mark End</button>
            <span>{customEnd !== null ? (customEnd/1000).toFixed(2) + "s" : "--"}</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={previewCustom} disabled={customStart===null || customEnd===null || customStart>=customEnd} style={{ padding: "4px 12px", backgroundColor: "#6c757d", color: "#fff", border: "none", borderRadius: "4px" }}>Preview</button>
            <button onClick={tryCustom} disabled={customStart===null || customEnd===null || customStart>=customEnd} style={{ padding: "4px 12px", backgroundColor: "#28a745", color: "#fff", border: "none", borderRadius: "4px" }}>Try It</button>
          </div>
        </div>
      )}

      {/* Post-interval Options */}
      {afterInterval && (activeIntervalIndex !== null || (customStart !== null && customEnd !== null)) && (
        <div style={{
          marginTop: "1rem",
          display: "flex",
          justifyContent: "center",
          gap: "1rem",
        }}>
          {activeIntervalIndex !== null ? (
            <>
              <button onClick={() => previewInterval(activeIntervalIndex)}
                style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#6c757d", color: "#fff" }}>
                Preview Again
              </button>
              <button onClick={() => tryInterval(activeIntervalIndex)}
                style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#28a745", color: "#fff" }}>
                Try It
              </button>
            </>
          ) : (
            <>
              <button onClick={previewCustom}
                style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#6c757d", color: "#fff" }}>
                Preview Again
              </button>
              <button onClick={tryCustom}
                style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#28a745", color: "#fff" }}>
                Try It
              </button>
            </>
          )}
          <button onClick={cancelInterval}
            style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#dc3545", color: "#fff" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}