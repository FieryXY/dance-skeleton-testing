import React, { useState, useRef, useEffect } from "react";
import type { RefObject } from "react";
import SkeletonViewer from "../skeleton-viewer/skeleton-viewer"; // Adjust path as needed
import VideoPlayer from "../video-player/VideoPlayer";
import * as poseDetection from '@tensorflow-models/pose-detection';
import type { LevelData, TimestampedPoses, FeedbackResponse, MiniFeedbackResponse, ProcessedFeedbackRecommendation } from "~/api/endpoints";
import endpoints from "~/api/endpoints";
import { angles_to_consider, SessionScorer } from "../skeleton-viewer/utils";
import { useNavigate, useParams } from 'react-router';
import { loadCalibrationMs, useCalibration } from '../utils/calibration';

const FEED_SIZE = 500; // Square size in pixels
const BAD_KEYPOINT_THRESHOLD = 40;

type ControlMode = 'intervalSelect' | 'practice' | 'recommendation';

export default function PoseComparisonPage() {
  const [videoURL, setVideoURL] = useState<string | null>(null);
  const [levelData, setLevelData] = useState<LevelData | null>(null);
  const { objectId } = useParams();
  const navigate = useNavigate();
  const [annotatedVideoUrl, setAnnotatedVideoUrl] = useState<string | null>(null);
  const scorerRef = useRef<SessionScorer | null>(null);
  const [calibration, setCalibration] = useCalibration();
  const [windowScore, setWindowScore] = useState<number | null>(null);
  const [badKeypoints, setBadKeypoints] = useState<string[]>([]);
  // Feedback dialog state
  const [feedbackData, setFeedbackData] = useState<FeedbackResponse | null>(null);
  const [miniFeedbackData, setMiniFeedbackData] = useState<MiniFeedbackResponse | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);
  const [feedbackModalType, setFeedbackModalType] = useState<'big' | 'mini' | null>(null);
  // Loading indicator for Gemini calls
  const [loading, setLoading] = useState<boolean>(false);

  // Mini-interval session state
  const [miniMode, setMiniMode] = useState<boolean>(false);
  const [miniRecommendation, setMiniRecommendation] = useState<ProcessedFeedbackRecommendation | null>(null);
  const [previousMiniAttemptFile, setPreviousMiniAttemptFile] = useState<File | null>(null);
  // Store the most recent big-interval attempt video (for first mini attempts)
  const [lastBigAttemptFile, setLastBigAttemptFile] = useState<File | null>(null);
  // Preserve main-interval context when switching to mini mode
  const [bigContext, setBigContext] = useState<{
    activeIntervalIndex: number | null;
    customStart: number | null;
    customEnd: number | null;
    afterInterval: boolean;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeUpdateListenerRef = useRef<((this: HTMLVideoElement, ev: Event) => any) | null>(null);
  // Interval interaction state
  const [activeIntervalIndex, setActiveIntervalIndex] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<"preview" | "try" | "loop" | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [afterInterval, setAfterInterval] = useState<boolean>(false);
  const [controlMode, setControlMode] = useState<ControlMode>('intervalSelect');
  // custom interval selection
  const [customStart, setCustomStart] = useState<number | null>(null);
  const [customEnd, setCustomEnd] = useState<number | null>(null);
  // Track which interval the last feedback corresponds to
  const [lastFeedbackContext, setLastFeedbackContext] = useState<{ type: 'big' | 'mini'; intervalIndex: number | null; start: number; end: number } | null>(null);
  // Ref to keep latest interactionMode value inside callbacks
  const interactionModeRef = useRef<"preview" | "try" | "loop" | null>(null);
  const webcamMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const webcamRecordingStartTimestampRef = useRef<number | null>(null);
  // Playback rate state for VideoPlayer
  const [playbackRate, setPlaybackRate] = useState(1);
  const handlePlaybackRateChange = (rate: number) => setPlaybackRate(rate);

  // New state variables to control visibility of feeds
  const [showWebcam, setShowWebcam] = useState(true);
  const [showAnnotatedVideo, setShowAnnotatedVideo] = useState(true);
  const [showLastAttemptModal, setShowLastAttemptModal] = useState<boolean>(false);
  const [lastAttemptModalVideoUrl, setLastAttemptModalVideoUrl] = useState<string | null>(null);

  // Fetch when objectId (levelCode) is present
  useEffect(() => {
    if (objectId) {
      handleFetch();
      setControlMode('intervalSelect');
    }
    else {
      // Go to a 404 page using react router
      navigate('/not-found', { replace: true });
    }
  }, [objectId]);

  // Keep ref in sync with state
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  // Function to handle webcam pose reporting
  const handleWebcamPose = (data: TimestampedPoses) => {
    const originalTimestamp = (videoRef.current?.currentTime ?? 0) * 1000;
    if (scorerRef.current && interactionModeRef.current === "try" && webcamRecordingStartTimestampRef.current && webcamMediaRecorderRef.current) {
      data.timestamp = Date.now() - webcamRecordingStartTimestampRef.current;
      if(calibration) {
        data.timestamp -= calibration;
      }
      const score = scorerRef.current.consumePose(data, originalTimestamp);
      if (typeof score["total"] === "number") {
        setWindowScore(score["total"]);
      }

      if (score) {
        const badKeypoints: string[] = [];
        for (const angleName in score) {
          if (angleName === "total") continue;
          if (typeof score[angleName] === "number" && score[angleName] < BAD_KEYPOINT_THRESHOLD) {
            const middleKeypoint = angles_to_consider[angleName]["keypoints"][1];
            if (middleKeypoint) {
              badKeypoints.push(middleKeypoint);
            }
          }
        }
        setBadKeypoints(badKeypoints);
      }
    }
  };

  // Fetch level data and associated annotated video
  const handleFetch = async () => {
    if (!objectId) return;
    try {
      const [videoUrl, level] = await Promise.all([
        endpoints.getOriginalVideo(objectId),
        endpoints.getLevel(objectId),
      ]);
      setAnnotatedVideoUrl(videoUrl);
      setLevelData(level);
      scorerRef.current = null;
    } catch (err) {
      alert("Failed to fetch video or level data");
      console.error(err);
    }
  };

  // Helper to actually play an arbitrary segment
  const playSegment = (startMs: number, endMs: number, loop: boolean = false) => {
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

    const handleTimeUpdateForLoop = () => {
      if (video.currentTime * 1000 >= endMs) {
        video.currentTime = startMs / 1000; // Loop back to start
      }
    }

    if(loop) {
      video.addEventListener("timeupdate", handleTimeUpdateForLoop);
      timeUpdateListenerRef.current = handleTimeUpdateForLoop;
    }
    else {
      video.addEventListener("timeupdate", handleTimeUpdate);
      timeUpdateListenerRef.current = handleTimeUpdate;
    }

    // Start playback
    video.play();
  };

  // Helper: play segment by interval index
  const startVideoSegment = (intervalIdx: number, loop: boolean = false) => {
    if (!levelData) return;
    const [startMs, endMs] = levelData.intervals[intervalIdx];
    playSegment(startMs, endMs, loop);
  };

  // Called whenever an interval finishes (preview or try)
  const handleIntervalEnd = async () => {
    if (interactionMode === "try") {
      // Compile session data
      const sessionSummary = {
        intervalScores: scorerRef.current?.computeIntervalScores() ?? [],
        beginTimestamp: activeIntervalIndex !== null ? levelData?.intervals[activeIntervalIndex][0] : customStart,
        endTimestamp: activeIntervalIndex !== null ? levelData?.intervals[activeIntervalIndex][1] : customEnd,
        custom: customStart !== null && customEnd !== null && customStart < customEnd,
      } as const;

      if(!scorerRef.current) {
        console.error("Scorer is not initialized");
        cancelInterval();
        return;
      }

      if(!webcamMediaRecorderRef.current) {
        console.error("Webcam media recorder is not initialized");
        cancelInterval();
        return;
      }

      if(typeof sessionSummary.beginTimestamp !== "number" || typeof sessionSummary.endTimestamp !== "number") {
        console.error("Begin or end timestamp is not set");
        cancelInterval();
        return;
      }

      if(!sessionSummary.intervalScores || sessionSummary.intervalScores.length === 0) {
        console.error("Interval scores are not set");
        cancelInterval();
        return;
      }

      // Get MP4 blob of webcam recording
      webcamMediaRecorderRef.current.requestData();

      const file = await new Promise<File>((res, rej) => {
        if(!webcamMediaRecorderRef.current) {
          console.error("Blob to file conversion failed: webcam media recorder is not initialized");
          rej(new Error("Webcam media recorder is not initialized"));
          return;
        }
        webcamMediaRecorderRef.current.addEventListener('dataavailable',
          e => res(new File([e.data], 'attempt.webm', { type: e.data.type })),
          { once: true }
        );
        webcamMediaRecorderRef.current.stop();
      });

      // Decide which feedback endpoint to call
      try {
        setLoading(true);
        if (miniMode && miniRecommendation) {
          let prevVideo = previousMiniAttemptFile;

          if(prevVideo == null && lastBigAttemptFile) {
            // Extend range by 2 seconds on either side
            miniRecommendation.mappedStartTimestamp! -= 2000;
            miniRecommendation.mappedEndTimestamp! += 2000;
            prevVideo = await endpoints.trimVideo(lastBigAttemptFile, miniRecommendation.mappedStartTimestamp!, miniRecommendation.mappedEndTimestamp!);
          }

          if (!prevVideo) {
            alert("Previous attempt video unavailable. Try the big interval first.");
            setLoading(false);
            cancelInterval();
            return;
          }

          if(!objectId) {
            alert("Missing level code in URL");
            setLoading(false);
            cancelInterval();
            return;
          }

          const miniResp = await endpoints.getMiniFeedback(
            objectId,
            file,
            prevVideo,
            miniRecommendation.startTimestamp!,
            miniRecommendation.endTimestamp!,
            miniRecommendation.description,
            playbackRate
          );

          setMiniFeedbackData(miniResp);
          // setLastFeedbackContext({ type: 'mini', intervalIndex: null, start: miniRecommendation.startTimestamp!, end: miniRecommendation.endTimestamp! });
          setShowFeedbackModal(true);
          setFeedbackModalType('mini');
        } else {


          if(!objectId) {
            alert("Missing level code in URL");
            setLoading(false);
            cancelInterval();
            return;
          }

          const feedback = await endpoints.getFeedback(
            objectId,
            file,
            sessionSummary.beginTimestamp,
            sessionSummary.endTimestamp,
            scorerRef.current.getTimestampScores() ?? [],
            sessionSummary.intervalScores[0],
            playbackRate
          );
          setFeedbackData(feedback);
          // Track which interval this feedback applies to
          setLastFeedbackContext({
            type: 'big',
            intervalIndex: activeIntervalIndex,
            start: sessionSummary.beginTimestamp!,
            end: sessionSummary.endTimestamp!,
          });
          setShowFeedbackModal(true);
          setFeedbackModalType('big');
          // Store big interval attempt for potential mini sessions
          setLastBigAttemptFile(file);
        }
      } catch (err) {
        console.error(err);
        alert("Failed to fetch feedback");
      } finally {
        setLoading(false);
      }

      // Update previous mini attempt reference
      if (miniMode) {
        setPreviousMiniAttemptFile(file);
      }
    }

    // Show post-interval options (now handled by control panel)
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

  const loopInterval = (idx: number) => {
    setActiveIntervalIndex(idx);
    setInteractionMode("loop");
    setAfterInterval(false);
    startVideoSegment(idx, true);
  }

  // Try It button handler
  const tryInterval = async (idx: number) => {
    if (!levelData) return;

    setActiveIntervalIndex(idx);
    setInteractionMode("try");
    setAfterInterval(false);

    // Pause video if playing
    if (videoRef.current) {
      videoRef.current.pause();
    }

    // Reset scorer
    scorerRef.current = new SessionScorer(levelData, 500, [[levelData.intervals[idx][0], levelData.intervals[idx][1]]]);

    // Start webcam recording
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamMediaRecorderRef.current = new MediaRecorder(stream, {mimeType: "video/webm"});
    webcamMediaRecorderRef.current.start();
    webcamRecordingStartTimestampRef.current = Date.now();

    // Start countdown
    setCountdown(3);
  };

  // Cancel the current interaction mode
  const cancelInterval = () => {
    setAfterInterval(false);
    setInteractionMode(null);
    setCountdown(null);

    if (videoRef.current) {
      videoRef.current.pause();
    }
    if (webcamMediaRecorderRef.current) {
      try { webcamMediaRecorderRef.current.stop(); } catch {}
      webcamMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      webcamMediaRecorderRef.current = null;
      webcamRecordingStartTimestampRef.current = null;
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

  const loopCustom = () => {
    if (customStart === null || customEnd === null || customStart >= customEnd) return;
    setActiveIntervalIndex(null);
    setInteractionMode("loop");
    setAfterInterval(false);
    playSegment(customStart, customEnd, true);
  }

  const tryCustom = async () => {
    if (!levelData || customStart === null || customEnd === null || customStart >= customEnd) return;
    setActiveIntervalIndex(null);
    setInteractionMode("try");
    setAfterInterval(false);

    scorerRef.current = new SessionScorer(levelData, 500, [[customStart, customEnd]]);

    // Start webcam recording
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamMediaRecorderRef.current = new MediaRecorder(stream, {mimeType: "video/webm"});
    webcamMediaRecorderRef.current.start();
    webcamRecordingStartTimestampRef.current = Date.now();

    setCountdown(3);
  };

  // Helper to format milliseconds into mm:ss:ms (e.g., 01:23:456)
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const milliseconds = Math.floor(ms % 1000).toString().padStart(3, '0');
    return `${minutes}:${seconds}:${milliseconds}`;
  };

  const feedContainerStyle = {
    width: FEED_SIZE,
    height: FEED_SIZE,
    backgroundColor: "transparent",
    borderRadius: "8px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
  };

  const hasCustom = customStart !== null && customEnd !== null && customStart < customEnd;

  const previewCurrent = () => {
    if (activeIntervalIndex !== null) return previewInterval(activeIntervalIndex);
    if (hasCustom) return previewCustom();
  };
  const loopCurrent = () => {
    if (activeIntervalIndex !== null) return loopInterval(activeIntervalIndex);
    if (hasCustom) return loopCustom();
  };
  const tryCurrent = async () => {
    if (activeIntervalIndex !== null) return tryInterval(activeIntervalIndex);
    if (hasCustom) return tryCustom();
  };

  const showRecAgainVisible = (() => {
    if (controlMode === 'practice') {
      if (!feedbackData || !lastFeedbackContext) return false;
      if (activeIntervalIndex !== null) return lastFeedbackContext.intervalIndex === activeIntervalIndex;
      if (hasCustom) return lastFeedbackContext.start === customStart && lastFeedbackContext.end === customEnd;
      return false;
    }
    if (controlMode === 'recommendation') {
      // Always allow opening the main recommendations again
      return !!feedbackData;
    }
    return false;
  })();

  const openRecommendations = () => {
    if (controlMode === 'recommendation' && feedbackData) {
      setFeedbackModalType('big');
      setShowFeedbackModal(true);
      return;
    }
    if (controlMode === 'practice' && feedbackData) {
      setFeedbackModalType('big');
      setShowFeedbackModal(true);
    }
  };

  const returnToIntervalSelection = () => {
    cancelInterval();
    setMiniMode(false);
    setMiniRecommendation(null);
    setPreviousMiniAttemptFile(null);
    setActiveIntervalIndex(null);
    setControlMode('intervalSelect');
  };

  const handleWatchLastAttemptEntireVideo = async () => {
    if(!lastBigAttemptFile) return;
    try {
      setLoading(true);
      const videoUrl = URL.createObjectURL(lastBigAttemptFile);
      setLastAttemptModalVideoUrl(videoUrl);
      setShowLastAttemptModal(true);
    } catch (err) {
      console.error("Failed to watch last attempt entire video:", err);
      alert("Failed to load last attempt video.");
    } finally {
      setLoading(false);
    }
  }

  const handleWatchLastAttempt = async () => {
    if (!miniRecommendation || !lastBigAttemptFile) return;

    try {

      setLoading(true);

      if(previousMiniAttemptFile) {
        const videoUrl = URL.createObjectURL(previousMiniAttemptFile);
        setLastAttemptModalVideoUrl(videoUrl);
        setShowLastAttemptModal(true);
        return;
      }
      const trimmedVideo = await endpoints.trimVideo(
        lastBigAttemptFile,
        miniRecommendation.mappedStartTimestamp!,
        miniRecommendation.mappedEndTimestamp!
      );
      const videoUrl = URL.createObjectURL(trimmedVideo);
      setLastAttemptModalVideoUrl(videoUrl);
      setShowLastAttemptModal(true);
    } catch (err) {
      console.error("Failed to trim video for last attempt:", err);
      alert("Failed to load last attempt video.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInterval = async () => {
      if (customStart === null || customEnd === null || customStart >= customEnd || !objectId) {
          alert("Please set a valid start and end time for the custom interval first.");
          return;
      }
      try {
          const updatedLevel = await endpoints.addInterval(objectId, customStart, customEnd);
          setLevelData(updatedLevel); // This updates the UI with the new interval
          alert(`Successfully created new interval! It is now Interval #${updatedLevel.intervals.length}.`);
          // Reset custom interval selection
          setCustomStart(null);
          setCustomEnd(null);
      } catch (err) {
          alert("Failed to create the new interval.");
          console.error(err);
      }
  };

  const handleDeleteInterval = async (intervalIndex: number | null) => {
    if (intervalIndex === null || !objectId) return;
    if (confirm(`Are you sure you want to delete Interval #${intervalIndex + 1}?`)) {
        try {
            const updatedLevel = await endpoints.deleteInterval(objectId, intervalIndex);
            setLevelData(updatedLevel);
            alert(`Interval #${intervalIndex + 1} has been deleted.`);
            // Return to interval selection mode
            setControlMode('intervalSelect'); 
            setActiveIntervalIndex(null);
        } catch (err) {
            alert("Failed to delete the interval.");
            console.error(err);
        }
    }
  };
  return (
    <div style={{ padding: "2rem", paddingBottom: "260px" }}>
      {/* Back Button */}
      <button
        onClick={() => navigate("/")}
        style={{
          position: "absolute",
          top: "1rem",
          left: "1rem",
          padding: "0.5rem 1rem",
          backgroundColor: "#6c757d",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Back
      </button>

      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        gap: "2rem",
        flexWrap: "wrap" as const,
      }}>
        {/* Webcam Section */}
        <div style={{ position: "relative", minWidth: FEED_SIZE }}>
          <button
            onClick={() => setShowWebcam(!showWebcam)}
            style={{
              position: "absolute",
              top: showWebcam ? "-2rem" : "0",
              left: 0,
              padding: "0.5rem 1rem",
              backgroundColor: "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {showWebcam ? "Hide Webcam" : "Show Webcam"}
          </button>
          {showWebcam && (
            <div>
              <h2 style={{ marginBottom: "1rem", textAlign: "center" as const }}>Webcam</h2>
              <div style={feedContainerStyle}>
                <SkeletonViewer
                  reportPoses={handleWebcamPose}
                  useWebcam={true}
                  mediaStream={null}
                  width={FEED_SIZE}
                  height={FEED_SIZE}
                  badKeypointsProp={badKeypoints}
                />
              </div>
            </div>
          )}
        </div>

        {/* Annotated Video Section */}
        <div style={{ position: "relative", minWidth: FEED_SIZE }}>
          <button
            onClick={() => setShowAnnotatedVideo(!showAnnotatedVideo)}
            style={{
              position: "absolute",
              top: showAnnotatedVideo ? "-2rem" : (showWebcam ? "2rem" : "0"),
              left: 0,
              padding: "0.5rem 1rem",
              backgroundColor: "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {showAnnotatedVideo ? "Hide Video" : "Show Video"}
          </button>
          {showAnnotatedVideo && (
            <div>
              <h2 style={{ marginBottom: "1rem", textAlign: "center" as const }}>Video</h2>
              <div style={feedContainerStyle}>
                {annotatedVideoUrl ? (
                  <div style={{ position: "relative", width: "100%", height: "100%" }}>
                    <VideoPlayer
                      src={annotatedVideoUrl}
                      videoRef={videoRef as RefObject<HTMLVideoElement>}
                      style={{ width: '100%', height: '100%' }}
                      playbackRate={playbackRate}
                      onPlaybackRateChange={handlePlaybackRateChange}
                      freezePlaybackRate={interactionMode === 'try'}
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
                    {objectId ? 'Loading video…' : 'Missing ?levelCode in URL'}
                  </div>
                )}
              </div>
            </div>
          )}
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

      {/* Loading Indicator */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "1rem" }}>
          <div style={{
            border: "4px solid #f3f3f3",
            borderTop: "4px solid #3498db",
            borderRadius: "50%",
            width: "30px",
            height: "30px",
            animation: "spin 1s linear infinite",
          }} />
          {/* Keyframes */}
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg);} }`}</style>
        </div>
      )}

      {/* Bottom Control Panel */}
      <div style={{
        // position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        padding: "0.75rem",
      }}>
        <div style={{
          width: "min(1200px, 95%)",
          backgroundColor: "#e9ecef",
          color: "#000",
          borderRadius: 16,
          padding: "1rem",
          boxShadow: "0 -6px 20px rgba(0,0,0,0.15)",
        }}>
          {/* Mode label */}
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
            Mode: {controlMode === 'intervalSelect' ? 'Interval Selection Mode' : controlMode === 'practice' ? 'Practice Mode' : `Recommendation Mode (${miniRecommendation?.title ?? 'Unknown'})`}
          </div>

          {controlMode === 'intervalSelect' && (
            <div>
              {/* Top half: pre-made intervals */}
              <div style={{
                overflowX: 'auto',
                whiteSpace: 'nowrap' as const,
                paddingBottom: 8,
              }}>
                {levelData?.intervals?.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCustomStart(null); setCustomEnd(null);
                      setActiveIntervalIndex(idx);
                      setControlMode('practice');
                    }}
                    style={{
                      display: 'inline-block',
                      marginRight: 8,
                      marginBottom: 4,
                      padding: '8px 12px',
                      borderRadius: 999,
                      border: '1px solid #ced4da',
                      background: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Interval #{idx + 1}
                  </button>
                ))}
                {(!levelData || levelData.intervals.length === 0) && (
                  <span style={{ opacity: 0.6 }}>No predefined intervals.</span>
                )}
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: '#ced4da', margin: '8px 0' }} />

              {/* Bottom half: custom selection */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
                <span style={{ fontWeight: 600 }}>Custom</span>
                <button onClick={markCustomStart} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #adb5bd', background: '#fff' }}>
                  {customStart === null ? 'Set Start' : `Start: ${formatTime(customStart)}`}
                </button>
                <button onClick={markCustomEnd} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #adb5bd', background: '#fff' }}>
                  {customEnd === null ? 'Set End' : `End: ${formatTime(customEnd)}`}
                </button>
                <button
                  disabled={!hasCustom}
                  onClick={() => { setActiveIntervalIndex(null); setControlMode('practice'); }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: hasCustom ? '#28a745' : '#adb5bd',
                    color: '#fff',
                    cursor: hasCustom ? 'pointer' : 'not-allowed'
                  }}
                >
                  Go
                </button>
                <button
                  disabled={!hasCustom}
                  onClick={handleCreateInterval}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: hasCustom ? '#28a745' : '#adb5bd',
                    color: '#fff',
                    cursor: hasCustom ? 'pointer' : 'not-allowed'
                  }}
                >
                  Create Interval
                </button> 
              </div>
            </div>
          )}

          {controlMode !== 'intervalSelect' && (
            <div>
              {/* Row of action buttons */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                <button onClick={previewCurrent} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#6c757d', color: '#fff' }}>Preview</button>
                <button onClick={loopCurrent} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#ffc107', color: '#000' }}>Loop</button>
                <button onClick={tryCurrent} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#28a745', color: '#fff' }}>Try It</button>
                {/* Show a button to replay the full last big attempt when available */}
                {lastBigAttemptFile && !miniMode && (
                  <button
                    onClick={handleWatchLastAttemptEntireVideo}
                    style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#6f42c1', color: '#fff' }}
                  >
                    Watch Last Attempt
                  </button>
                )}
                {showRecAgainVisible && (
                  <button onClick={openRecommendations} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#17a2b8', color: '#fff' }}>Show Recommendations Again</button>
                )}
                {activeIntervalIndex !== null && (
                  <button onClick={() => handleDeleteInterval(activeIntervalIndex)} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#dc3545', color: '#fff' }}>
                    Delete Interval
                  </button>
                )}
                {controlMode === 'recommendation' && (
                  <button
                    onClick={handleWatchLastAttempt}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#e83e8c',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                    disabled={!lastBigAttemptFile || !miniRecommendation}
                  >
                    Watch Last Attempt
                  </button>
                )}
              </div>

              {/* Recommendation mode helper link */}
              {controlMode === 'recommendation' && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <button
                    onClick={() => {
                      // Restore previous big-interval context if available
                      if (bigContext) {
                        setActiveIntervalIndex(bigContext.activeIntervalIndex);
                        setCustomStart(bigContext.customStart);
                        setCustomEnd(bigContext.customEnd);
                        setAfterInterval(bigContext.afterInterval);
                      }
                      setMiniMode(false);
                      setMiniRecommendation(null);
                      setPreviousMiniAttemptFile(null);
                      setControlMode('practice');
                    }}
                    style={{ background: 'transparent', color: '#dc3545', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Return to Practice Mode
                  </button>
                </div>
              )}

              {/* Bottom wide button to return to Interval Selection */}
              <div style={{ marginTop: 12 }}>
                <button onClick={returnToIntervalSelection} style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid #adb5bd', background: '#f8f9fa' }}>
                  Back to Interval Selection
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Feedback Modal */}
      {showFeedbackModal && feedbackModalType === 'big' && feedbackData && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "#000",
            color: "#fff",
            padding: "2rem",
            borderRadius: "12px",
            width: "90%",
            maxWidth: "600px",
            maxHeight: "80%",
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.7)",
          }}>
            <h2 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "2rem", fontWeight: "bold" }}>{feedbackData.dialogHeader}</h2>
            <p style={{ margin: 0, lineHeight: 1.4 }}>{feedbackData.description}</p>
            <div style={{
              marginTop: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}>
              {feedbackData.recommendations.map((rec, idx) => (
                <div key={idx} style={{
                  backgroundColor: "#111",
                  padding: "1rem 1.25rem",
                  borderRadius: "8px",
                  width: "100%",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                    <h3 style={{ margin: "0 0 0.5rem 0", fontWeight: "bold", fontSize: "1.1rem" }}>{rec.title}</h3>
                    {rec.startTimestamp !== undefined && rec.endTimestamp !== undefined && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();

                          if(controlMode === "practice") {
                            // Save current big-interval context before switching
                            setBigContext({
                              activeIntervalIndex,
                              customStart,
                              customEnd,
                              afterInterval,
                            });
                          }

                          // Enter recommendation (mini) interval mode
                          setShowFeedbackModal(false);
                          setFeedbackModalType(null);
                          setMiniMode(true);
                          setMiniRecommendation(rec);
                          setCustomStart(rec.startTimestamp!);
                          setCustomEnd(rec.endTimestamp!);
                          setAfterInterval(true);
                          setActiveIntervalIndex(null);
                          setControlMode('recommendation');
                        }}
                        style={{ color: "#0d6efd", fontSize: "0.9rem" }}
                      >
                        {`Practice this Recommendation (${formatTime(rec.startTimestamp!)} - ${formatTime(rec.endTimestamp!)})`}
                      </a>
                    )}
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.4 }}>{rec.description}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setShowFeedbackModal(false); setFeedbackModalType(null); }}
              style={{
                marginTop: "1.5rem",
                padding: "10px 20px",
                border: "1px solid #fff",
                backgroundColor: "transparent",
                color: "#fff",
                borderRadius: "4px",
                cursor: "pointer",
                alignSelf: "center",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Mini Feedback Modal */}
      {showFeedbackModal && feedbackModalType === 'mini' && miniFeedbackData && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "#000",
            color: "#fff",
            padding: "2rem",
            borderRadius: "12px",
            width: "90%",
            maxWidth: "500px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.7)",
          }}>
            <h2 style={{ marginTop: 0, fontSize: "1.8rem", fontWeight: "bold" }}>Practice Feedback</h2>
            <p style={{ lineHeight: 1.4 }}>{miniFeedbackData.description}</p>
            {miniFeedbackData.sufficient && (
              <p style={{ marginTop: "1rem", color: "#28a745", fontWeight: "bold" }}>Great job! This looks sufficient.</p>
            )}
            <button
              onClick={() => { setShowFeedbackModal(false); setFeedbackModalType(null); }}
              style={{
                marginTop: "1.5rem",
                padding: "10px 20px",
                border: "1px solid #fff",
                backgroundColor: "transparent",
                color: "#fff",
                borderRadius: "4px",
                cursor: "pointer",
                alignSelf: "center",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Last Attempt Modal */}
      {showLastAttemptModal && lastAttemptModalVideoUrl && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "#000",
            color: "#fff",
            padding: "2rem",
            borderRadius: "12px",
            width: "90%",
            maxWidth: "600px",
            maxHeight: "80%",
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.7)",
          }}>
            <h2 style={{ marginTop: 0, fontSize: "1.8rem", fontWeight: "bold" }}>Last Attempt</h2>
            <video
              src={lastAttemptModalVideoUrl}
              controls
              style={{ width: "100%", borderRadius: "8px", marginTop: "1rem" }}
            />
            <button
              onClick={() => {
                setShowLastAttemptModal(false);
                setLastAttemptModalVideoUrl(null);
              }}
              style={{
                marginTop: "1.5rem",
                padding: "10px 20px",
                border: "1px solid #fff",
                backgroundColor: "transparent",
                color: "#fff",
                borderRadius: "4px",
                cursor: "pointer",
                alignSelf: "center",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
