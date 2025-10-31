// app/calibration-page/CalibrationPage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import SkeletonViewer from "../skeleton-viewer/skeleton-viewer"; // Adjust path as needed
import endpoints, { type LevelData, type TimestampedPoses } from "~/api/endpoints";
import { SessionScorer} from "../skeleton-viewer/utils";
// Note: Removed unused imports like useEffect, useParams, endpoints, SessionScorer, LevelData, etc.

/* ------------------------- CONFIG (Example values, not used functionally) ------------------------- */

const FEED_SIZE = 500;
const EXAMPLE_SCORE_THRESHOLD = 95; // Just for display text
const CALIBRATION_LEVEL_ID = "6902fa6a5f72ae637347c820";

/* ------------------------ PAGE --------------------------- */

export default function CalibrationPage() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { objectId } = useParams();
  const levelId = objectId || CALIBRATION_LEVEL_ID;

  const scorerRef = useRef<SessionScorer | null>(null);

  // Simplified state - only what's needed for basic UI interaction/display
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>(""); 
  const [status, setStatus] = useState<"idle" | "countdown" | "running" | "done">("idle");

  const [countdown, setCountdown] = useState<number | null>(null);
  const [liveScore, setLiveScore] = useState<number>(0); // Display a dummy score
  const [resultText, setResultText] = useState<string | null>(null); // Display a placeholder result
  
  const [annotatedUrl, setAnnotatedUrl] = useState<string>("");
  const [levelData, setLevelData] = useState<LevelData | null>(null);

  // --- Stripped Functional Logic ---

  // Placeholder for pose callback - does nothing
  const onPose = (data: TimestampedPoses) => {
    const originalTimestamp = (videoRef.current?.currentTime ?? 0) * 1000;
    if (scorerRef.current && status === "running") {
      const score = scorerRef.current.consumePose(data, originalTimestamp);
      if (typeof score["total"] === "number") {
        setLiveScore(score["total"]);
      }
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(""); // Clear previous errors
      try {
        // Fetch both the video URL and the level data
        const [videoUrl, lvlData] = await Promise.all([
          endpoints.getAnnotatedVideo(levelId),
          endpoints.getLevel(levelId), // Fetch level data even if logic is removed
        ]);
        setAnnotatedUrl(videoUrl);
        setLevelData(lvlData); // Store the level data
        console.log("Calibration level data loaded:", lvlData); // Optional: log loaded data
      } catch (e: any) {
        setMsg(`Failed to load calibration level: ${e?.message ?? String(e)}`);
        setAnnotatedUrl("");
        setLevelData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [levelId]);

  // Placeholder for start function
  const start = async () => {
    if (!levelData) {
      setMsg("Level data is not loaded. Cannot start calibration.");
      return;
    }

    console.log("Start Calibration button clicked"); // Updated log
    setResultText(null); // Clear previous placeholder result
    setLiveScore(0);
    setStatus("countdown");

    // --- Add this block to reset the video ---
    if (videoRef.current) {
      videoRef.current.currentTime = 0; // Rewind video to the start
      videoRef.current.onended = finish; // Call finish() when video ends
    }

    // Simulate countdown
    let count = 3;
    setCountdown(count);
    const interval = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count === 0) {
        clearInterval(interval);
        setCountdown(null);

        const durationMs = (videoRef.current?.duration ?? 0) * 1000;
        if (durationMs === 0) {
            setMsg("Video duration is unknown. Cannot start scorer.");
            return;
        }
        scorerRef.current = new SessionScorer(levelData, 500, [[0, durationMs]]);

        setStatus("running");
        console.log("Calibration running (simulated)");

        // --- Add this line to play the video ---
        videoRef.current?.play();
        
      }
    }, 1000);
  };

  // Placeholder for finish function
  const finish = () => {
    console.log("Calibration finished (logic removed)");
    setStatus("done");
    scorerRef.current = null;
    // --- Add this block to control video state ---
    if (videoRef.current) {
      videoRef.current.pause(); // Ensure video is paused
      videoRef.current.onended = null; // Clear the event handler
    }
    // --- End of new block ---

    // Display a placeholder result message
    const fakeOffset = Math.round((Math.random() - 0.5) * 500); // Example offset
    setResultText(`Placeholder Result: Offset: ${fakeOffset} ms`);
    // Original calculation and saving logic removed
  };

  // Determine if the start button should be enabled (simplified)
  const canStart = !!annotatedUrl && (status === "idle" || status === "done");

  // --- UI Rendering ---

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 2rem 8rem", color: "#fff" }}>
      <button onClick={() => nav("/")} style={backBtn}>Back</button>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: 12 }}>Calibration (score-based)</h1>

      {loading && <p>Loading…</p>}
      {msg && <p style={{ color: "#ff7676" }}>{msg}</p>}

      {/* Simplified content assuming video/components are always available */}
      <>
        <p>
          Imitate the reference. After each marked move, we measure how long it takes your rolling score to reach{" "}
          <b>{EXAMPLE_SCORE_THRESHOLD}</b>. The median delay becomes your calibration offset. (Functionality Removed)
        </p>

        <div style={grid2}>
          {/* Webcam panel with overlay button/countdown - MOVED TO THE LEFT */}
          <div style={{ ...panel, position: "relative", overflow: "hidden" }}>
            <h3 style={h3}>Your Camera</h3>
            <SkeletonViewer
              reportPoses={onPose} // Uses the dummy onPose
              useWebcam={true}
              mediaStream={null}
              width={FEED_SIZE}
              height={FEED_SIZE}
              badKeypointsProp={[]} // Static empty array
            />

            {/* Start overlay */}
            {canStart && (
              <div style={overlayShade}>
                <button onClick={start} style={ctaBtn}>
                  Start Calibration
                </button>
              </div>
            )}

            {/* Countdown overlay */}
            {status === "countdown" && countdown != null && (
              <div style={overlayShade}>
                <div style={countdownText}>{countdown}</div>
              </div>
            )}

            {/* Running badge */}
            {status === "running" && (
              <div style={runningPill}>Calibrating…</div>
            )}
          </div>

          {/* Reference video panel - MOVED TO THE RIGHT */}
          <div style={panel}>
            <h3 style={h3}>Reference</h3>
            {/* Display video controls, but source might be empty or a placeholder */}
            <video
              ref={videoRef}
              src={annotatedUrl || ""} // Use a placeholder or leave empty
              controls
              playsInline
              muted
              style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 8 }}
            />
            <p style={{ opacity: 0.85, marginTop: 8 }}>
              Moves: <b>(Example: 9)</b> {/* Static text */}
            </p>
          </div>
        </div>

        {/* Fallback button */}
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button onClick={start} disabled={!canStart} style={primary(!canStart)}>
            {status === "running" ? "Calibrating…" : "Start Calibration"}
          </button>
        </div>

        {/* Placeholder Result Display */}
        {resultText && (
          <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, background: "#141414" }}>
            <h3 style={{ margin: "0 0 8px 0" }}>Result</h3>
            <p style={{ margin: 0 }}>{resultText}</p>
            <p style={{ opacity: 0.8, marginTop: 6 }}>
              (Calibration logic removed. This is a placeholder.)
            </p>
          </div>
        )}
      </>

      {/* Big bottom score banner - displays dummy score */}
      <ScoreBanner score={liveScore} currentDelay={null} /> {/* Pass null for delay */}
    </div>
  );
}

/* ------------------ SCORE BANNER (Bottom - Unchanged) ----------------- */
// Modified slightly to accept and optionally display delay
function ScoreBanner({ score, currentDelay }: { score: number, currentDelay: number | null }) {
    const clampedScore = Math.max(-10, Math.min(100, Number.isFinite(score) ? score : 0));
    const scoreTxt = clampedScore.toFixed(2);
    const delayTxt = currentDelay !== null ? `${currentDelay} ms` : "--";

    return (
      <div style={scoreWrap}>
        <div style={scoreText}>{scoreTxt}</div>
        {/* Optionally display delay if you re-add that state */}
        {/* <div style={currentDelayStyle}>Current Offset: {delayTxt}</div> */}
      </div>
    );
  }

/* ----------------------- STYLES (Unchanged from original) ----------------------- */

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 };
const panel: React.CSSProperties = { background: "#141414", border: "1px solid #2a2a2a", borderRadius: 12, padding: 12 };
const h3: React.CSSProperties = { fontSize: "1.05rem", fontWeight: 600, margin: "0 0 6px 0", opacity: 0.9 };
const backBtn: React.CSSProperties = { position: "absolute", top: "1rem", left: "1rem", padding: "0.5rem 1rem", background: "#6c757d", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" };
const primary = (disabled:boolean): React.CSSProperties => ({ padding: "10px 16px", background: disabled ? "#6c757d" : "#007bff", color:"#fff", border:"none", borderRadius: 6, cursor: disabled ? "default" : "pointer", fontWeight:600 });

const overlayShade: React.CSSProperties = {
  position: "absolute",
  inset: 12, // Assuming panel padding is 12
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.35)",
  borderRadius: 8, // Match panel inner radius if needed
  zIndex: 2,
};

const ctaBtn: React.CSSProperties = {
  padding: "14px 22px",
  background: "#00b894", // A distinct green
  color: "#0b0b0b", // Dark text for contrast
  border: "none",
  borderRadius: 999, // Pill shape
  fontWeight: 800,
  fontSize: 16,
  cursor: "pointer",
  boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
};

const countdownText: React.CSSProperties = {
  fontSize: 72,
  fontWeight: 900,
  color: "#fff",
  textShadow: "0 8px 24px rgba(0,0,0,0.6)",
};

const runningPill: React.CSSProperties = {
  position: "absolute",
  right: 20, // Adjust based on panel padding
  top: 20,   // Adjust based on panel padding
  background: "#007bff", // Blue indicator
  color: "#fff",
  padding: "6px 10px",
  borderRadius: 999, // Pill shape
  fontWeight: 700,
  zIndex: 2,
};

// Styles for the score banner
const scoreWrap: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  background: "#000", // Black background
  minHeight: 110, // Ensure enough height
  display: "flex",
  flexDirection: "column", // Stack score and delay vertically
  alignItems: "center",
  justifyContent: "center",
  zIndex: 999, // Ensure it's on top
};
const scoreText: React.CSSProperties = {
  color: "#fff",
  fontSize: 64,
  fontWeight: 800,
  letterSpacing: 0.5,
  fontVariantNumeric: "tabular-nums", // Keeps numbers aligned
  textAlign: "center",
};
// Style for delay text (optional, if you add it back to ScoreBanner)
const currentDelayStyle: React.CSSProperties = {
    color: "#adb5bd",
    fontSize: 18,
    marginTop: 4,
    textAlign: "center",
};