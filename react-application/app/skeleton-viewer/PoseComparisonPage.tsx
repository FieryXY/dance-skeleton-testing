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

  // Function to handle webcam pose reporting
  const handleWebcamPose = (data: TimestampedPoses) => {

    data.timestamp = (videoRef.current?.currentTime ?? 0) * 1000;

    setWebcamPose(prev => [...prev, data]);
    if (scorerRef.current) {
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
      scorerRef.current = new SessionScorer(level, 500, []);
    } catch (err) {
      alert("Failed to fetch video or level data");
      console.error(err);
    }
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
              <video 
                src={annotatedVideoUrl} 
                controls 
                style={feedStyle}
                ref={videoRef}
              />
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
    </div>
  );
}