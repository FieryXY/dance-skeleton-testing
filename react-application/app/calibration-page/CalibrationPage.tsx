import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import SkeletonViewer from "../skeleton-viewer/skeleton-viewer"; 
import endpoints, { type LevelData, type TimestampedPoses } from "~/api/endpoints";
import { SessionScorer} from "../skeleton-viewer/utils";
import { saveCalibrationMs } from "../utils/calibration";

const FEED_SIZE = 500;
const EXAMPLE_SCORE_THRESHOLD = 95;
const CALIBRATION_LEVEL_ID = "6902fa6a5f72ae637347c820";
const TARGET_MOVE_TIMESTAMPS = [2.0, 6.0, 10.0, 13.0, 16.0, 20.0, 22.0, 25.5, 28.0];


export default function CalibrationPage() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { objectId } = useParams();
  const levelId = objectId || CALIBRATION_LEVEL_ID;

  const scorerRef = useRef<SessionScorer | null>(null);
  const [scorerReady, setScorerReady] = useState(false);   
  const runStartRef = useRef<number | null>(null);
  const scoreTimelineRef = useRef<Array<{ videoTs: number; score: number; wallTs: number }>>([]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>(""); 
  const [status, setStatus] = useState<"idle" | "countdown" | "running" | "done">("idle");

  const statusRef = useRef<"idle" | "countdown" | "running" | "done">("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  
  const [showStartOverlay, setShowStartOverlay] = useState(true);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [liveScore, setLiveScore] = useState<number>(0); 
  const [resultText, setResultText] = useState<string | null>(null); 
  
  const [annotatedUrl, setAnnotatedUrl] = useState<string>("");
  const [levelData, setLevelData] = useState<LevelData | null>(null);
  const [calibrationMs, setCalibrationMs] = useState<number | null>(null);

  const onPose = (data: TimestampedPoses) => {
    if (!scorerRef.current) return;
    if (statusRef.current !== "running") return;

    if (runStartRef.current) {
      data.timestamp = Date.now() - runStartRef.current;
    }

    const originalTimestamp = (videoRef.current?.currentTime ?? 0) * 1000;
    const score = scorerRef.current.consumePose(data, originalTimestamp);
    if (score && typeof score.total === "number") {
      setLiveScore(score.total);
      scoreTimelineRef.current.push({ videoTs: originalTimestamp, score: score.total, wallTs: Date.now() });
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");
      try {
        
        const [videoUrl, lvlData] = await Promise.all([
          endpoints.getAnnotatedVideo(levelId),
          endpoints.getLevel(levelId), 
        ]);
        setAnnotatedUrl(videoUrl);
        setLevelData(lvlData);
        console.log("Calibration level data loaded:", lvlData); 
      } catch (e: any) {
        setMsg(`Failed to load calibration level: ${e?.message ?? String(e)}`);
        setAnnotatedUrl("");
        setLevelData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [levelId]);

  const handleVideoReady = () => {
    if (!levelData || !videoRef.current) {
      console.warn("Video is ready, but levelData or ref is missing.");
      return;
    }

    const durationMs = (videoRef.current.duration ?? 0) * 1000;
    if (durationMs === 0) {
      setMsg("Video loaded but duration is 0. Cannot initialize scorer.");
      return;
    }
    
    console.log(`Video ready. Initializing scorer with duration: ${durationMs}ms`);
    scorerRef.current = new SessionScorer(levelData, 500, [[0, durationMs]]);
    setScorerReady(true);          
    setStatus(prev =>
      prev === "idle" || prev === "done" ? "idle" : prev
    );
    console.log("Scorer initialized:", scorerRef.current);
  };
  const start = () => {
    if (!videoRef.current) return; 
    setShowStartOverlay(false);
    setLiveScore(0);
    setStatus("countdown");

    videoRef.current.currentTime = 0;
    videoRef.current.onended = finish;

    let count = 3;
    setCountdown(count);
    
    const interval = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count === 0) {
        clearInterval(interval);
        setCountdown(null);
        
        runStartRef.current = Date.now();   
        setStatus("running");
        if (!videoRef.current) return;
        videoRef.current.play();
      }
    }, 1000);
  };

  const finish = () => {
    console.log("Calibration finished — computing calibration offsets");
    setStatus("done");
    scorerRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.onended = null; 
    }

    // Compute how long after each target timestamp the user's rolling score first exceeded the threshold
    const timeline = scoreTimelineRef.current.slice(); // copy
    const targetMs = TARGET_MOVE_TIMESTAMPS.map(s => Math.round(s * 1000));

    const perMoveResults: Array<{ targetMs: number; reachedAtMs: number | null; deltaMs: number | null }>
      = targetMs.map(t => ({ targetMs: t, reachedAtMs: null, deltaMs: null }));

    // For each move, find the first sample at or after target where score >= threshold
    for (let i = 0; i < perMoveResults.length; i++) {
      const t = perMoveResults[i].targetMs;
      for (let j = 0; j < timeline.length; j++) {
        const sample = timeline[j];
        if (sample.videoTs >= t && sample.score >= EXAMPLE_SCORE_THRESHOLD) {
          perMoveResults[i].reachedAtMs = sample.videoTs;
          perMoveResults[i].deltaMs = Math.max(0, Math.round(sample.videoTs - t));
          break;
        }
      }
    }

    // Compute average delta across moves that were reached
    const reachedDeltas = perMoveResults.map(r => r.deltaMs).filter((d): d is number => d != null);
    const avgMs = reachedDeltas.length > 0 ? Math.round(reachedDeltas.reduce((a, b) => a + b, 0) / reachedDeltas.length) : null;

    // Format result text with per-move details
    const perMoveText = perMoveResults
      .map((r, idx) => {
        if (r.deltaMs == null) return `Move ${idx + 1}: not reached`;
        return `Move ${idx + 1}: ${r.deltaMs} ms`;
      })
      .join("; ");

    setResultText(`Calibration average: ${avgMs != null ? `${avgMs} ms` : "— no moves reached 95"}. Details: ${perMoveText}`);

    // Save numeric calibration so other pages can read it (persist to localStorage)
    setCalibrationMs(avgMs);
    try {
      saveCalibrationMs(avgMs);
    } catch (e) {
      console.warn("Failed to persist calibration:", e);
    }

    // Reset timeline for next run
    scoreTimelineRef.current = [];
  };

  const canStart = scorerReady && (status === "idle" || status === "done");


  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 2rem 8rem", color: "#fff" }}>
      <button onClick={() => nav("/")} style={backBtn}>Back</button>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: 12 }}>Calibration (score-based)</h1>

      {loading && <p>Loading…</p>}
      {msg && <p style={{ color: "#ff7676" }}>{msg}</p>}

      <>
        <p>
          Imitate the reference. After each marked move, we measure how long it takes your rolling score to reach{" "}
          <b>{EXAMPLE_SCORE_THRESHOLD}</b>. The median delay becomes your calibration offset.
        </p>

        <div style={grid2}>
          <div style={{ ...panel, position: "relative", overflow: "hidden" }}>
            <h3 style={h3}>Your Camera</h3>
            <SkeletonViewer
              reportPoses={onPose} 
              useWebcam={true}
              mediaStream={null}
              width={FEED_SIZE}
              height={FEED_SIZE}
              badKeypointsProp={[]} 
            />

            {showStartOverlay && canStart && (
              <div style={overlayShade}>
                <button onClick={start} style={ctaBtn}>
                  Start Calibration
                </button>
              </div>
            )}

            {status === "countdown" && countdown != null && (
              <div style={overlayShade}>
                <div style={countdownText}>{countdown}</div>
              </div>
            )}

            {status === "running" && (
              <div style={runningPill}>Calibrating…</div>
            )}
          </div>

          <div style={panel}>
            <h3 style={h3}>Reference</h3>
            <video
              ref={videoRef}
              src={annotatedUrl || ""} 
              controls
              playsInline
              muted
              style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 8 }}
              onCanPlay={handleVideoReady}
            />
            <p style={{ opacity: 0.85, marginTop: 8 }}>
              Moves: <b>(Example: 9)</b> 
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button onClick={start} disabled={!canStart} style={primary(!canStart)}>
            {status === "running" ? "Calibrating…" : "Start Calibration"}
          </button>
        </div>

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
