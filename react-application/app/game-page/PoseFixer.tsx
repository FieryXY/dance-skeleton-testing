import React, { useRef, useState } from "react";
import SkeletonViewer from "../skeleton-viewer/skeleton-viewer";
import VideoPlayer from "../video-player/VideoPlayer";
import { getPoseFromTimestamp } from "../skeleton-viewer/utils";
import type { LevelData, TimestampedPoses } from "~/api/endpoints";

interface PoseFixerProps {
  videoSrc: string;
  levelData: LevelData;
}

const PoseFixer: React.FC<PoseFixerProps> = ({ videoSrc, levelData }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Get the closest pose to the current video time
  const getReferencePose = () => {
    if (!levelData || !levelData.pose_data) return null;
    const poseObj = getPoseFromTimestamp(levelData.pose_data, currentTime * 1000);
    return poseObj && poseObj.poses.length > 0 ? poseObj.poses[0] : null;
  };

  // Update currentTime as the video plays
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <div style={{ flex: 1, borderRight: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SkeletonViewer
          reportPoses={() => {}}
          useWebcam={false}
          mediaStream={null}
          overlay_type="pose_fixer"
          getReferencePose={getReferencePose}
					badKeypointsProp={[]}
        />
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <VideoPlayer
          src={videoSrc}
          videoRef={videoRef}
          playbackRate={1}
          onPlaybackRateChange={() => {}}
          freezePlaybackRate={false}
          style={{ width: "100%", height: "100%" }}
        />
        <video
          ref={videoRef}
          style={{ display: "none" }}
          onTimeUpdate={handleTimeUpdate}
        />
      </div>
    </div>
  );
};

export default PoseFixer;
