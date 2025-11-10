import React, { useState, useRef, useEffect } from "react";
import type { RefObject } from "react";
import SkeletonViewer from "./skeleton-viewer"; // Adjust path as needed
import VideoPlayer from "../video-player/VideoPlayer";
import * as poseDetection from '@tensorflow-models/pose-detection';
import type { LevelData, TimestampedPoses, FeedbackResponse, MiniFeedbackResponse, ProcessedFeedbackRecommendation } from "~/api/endpoints";
import endpoints from "~/api/endpoints";
import { angles_to_consider, SessionScorer } from "./utils";

const FEED_SIZE = 500; // Square size in pixels
const BAD_KEYPOINT_THRESHOLD = 40;

export default function PoseComparisonPage() {
  const [videoURL, setVideoURL] = useState<string | null>(null);
  const [levelData, setLevelData] = useState<LevelData | null>(null);
  const [objectId, setObjectId] = useState("");
  const [annotatedVideoUrl, setAnnotatedVideoUrl] = useState<string | null>(null);
  const scorerRef = useRef<SessionScorer | null>(null);
  const offset: number = localStorage.getItem("calibrationOffsetMs") ? parseInt(localStorage.getItem("calibrationOffsetMs")!) : 0;
  const [windowScore, setWindowScore] = useState<number | null>(null);
  const [badKeypoints, setBadKeypoints] = useState<string[]>([]);
  // Feedback dialog state
  const [feedbackData, setFeedbackData] = useState<FeedbackResponse | null>(null);
  const [miniFeedbackData, setMiniFeedbackData] = useState<MiniFeedbackResponse | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);
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
  // custom interval selection
  const [customStart, setCustomStart] = useState<number | null>(null);
  const [customEnd, setCustomEnd] = useState<number | null>(null);
  // Ref to keep latest interactionMode value inside callbacks
  const interactionModeRef = useRef<"preview" | "try" | "loop" | null>(null);
  const webcamMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const webcamRecordingStartTimestampRef = useRef<number | null>(null);
  // Playback rate state for VideoPlayer
  const [playbackRate, setPlaybackRate] = useState(1);
  const handlePlaybackRateChange = (rate: number) => setPlaybackRate(rate);

  // Keep ref in sync with state
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  // Function to handle webcam pose reporting
  const handleWebcamPose = (data: TimestampedPoses) => {
    const originalTimestamp = (videoRef.current?.currentTime ?? 0) * 1000;
    if (scorerRef.current && interactionModeRef.current === "try" && webcamRecordingStartTimestampRef.current && webcamMediaRecorderRef.current) {
      data.timestamp = Date.now() - webcamRecordingStartTimestampRef.current + offset;
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
        endpoints.getAnnotatedVideo(objectId),
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
      console.log("Removing previous timeupdate listener");
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
      };

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
            prevVideo = await endpoints.trimVideo(lastBigAttemptFile, miniRecommendation.mappedStartTimestamp!, miniRecommendation.mappedEndTimestamp!);
          }

          if (!prevVideo) {
            alert("Previous attempt video unavailable. Try the big interval first.");
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
        } else {
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
          // Store big interval attempt for potential mini sessions
          setLastBigAttemptFile(file);
        }
        setShowFeedbackModal(true);
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
    if (webcamMediaRecorderRef.current) {
      webcamMediaRecorderRef.current.stop();
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
              <button
                onClick={() => loopInterval(idx)}
                style={{ padding: "4px 12px", borderRadius: "4px", border: "none", backgroundColor: "#ffc107", color: "#000" }}
              >
                Loop
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
              badKeypointsProp={badKeypoints}
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
            <button onClick={loopCustom} disabled={customStart===null || customEnd===null || customStart>=customEnd} style={{ padding: "4px 12px", backgroundColor: "#ffc107", color: "#000", border: "none", borderRadius: "4px" }}>Loop</button>
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
              <button
                onClick={() => loopInterval(activeIntervalIndex)}
                style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#ffc107", color: "#000" }}
              >
                Loop
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
              <button
                onClick={loopCustom}
                style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#ffc107", color: "#000" }}
              >
                Loop
              </button>
            </>
          )}
          {(feedbackData || miniFeedbackData) && (
            <button
              onClick={() => setShowFeedbackModal(true)}
              style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#17a2b8", color: "#fff" }}
            >
              Show Recommendations Again
            </button>
          )}
          <button onClick={cancelInterval}
            style={{ padding: "8px 14px", borderRadius: "4px", border: "none", backgroundColor: "#dc3545", color: "#fff" }}>
            Cancel
          </button>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && feedbackData && (
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
            {/* Optional overall description could go here if available */}
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
                          // Save current big-interval context before switching
                          setBigContext({
                            activeIntervalIndex,
                            customStart,
                            customEnd,
                            afterInterval,
                          });

                          // Enter mini interval mode
                          setShowFeedbackModal(false);
                          setMiniMode(true);
                          setMiniRecommendation(rec);
                          setCustomStart(rec.startTimestamp!);
                          setCustomEnd(rec.endTimestamp!);
                          setAfterInterval(true);
                          setActiveIntervalIndex(null);
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
              onClick={() => setShowFeedbackModal(false)}
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
      {showFeedbackModal && miniFeedbackData && (
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
              onClick={() => setShowFeedbackModal(false)}
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

      {/* Mini mode banner & controls */}
      {miniMode && (
        <div style={{
          marginTop: "1rem",
          display: "flex",
          justifyContent: "center",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}>
          <span style={{ color: "#fff", backgroundColor: "#6c757d", padding: "4px 12px", borderRadius: "4px" }}>
            Practicing recommendation: {miniRecommendation?.title}
          </span>
          <button
            onClick={() => {
              // Restore previous big-interval context if available
              if (bigContext) {
                setActiveIntervalIndex(bigContext.activeIntervalIndex);
                setCustomStart(bigContext.customStart);
                setCustomEnd(bigContext.customEnd);
                setAfterInterval(bigContext.afterInterval);
              } else {
                // Fallback to resetting to full interval defaults
                setCustomStart(null);
                setCustomEnd(null);
                setAfterInterval(false);
                setActiveIntervalIndex(null);
              }

              // Exit mini mode and clear related state
              setMiniMode(false);
              setMiniRecommendation(null);
              setPreviousMiniAttemptFile(null);
            }}
            style={{ padding: "6px 12px", borderRadius: "4px", border: "none", backgroundColor: "#dc3545", color: "#fff" }}
          >
            Return to Full Interval
          </button>
        </div>
      )}
    </div>
  );
}