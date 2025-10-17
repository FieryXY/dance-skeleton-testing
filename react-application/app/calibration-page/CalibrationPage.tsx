// app/calibration-page/CalibrationPage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import SkeletonViewer from "../skeleton-viewer/skeleton-viewer";
import endpoints, { type LevelData, type TimestampedPoses } from "~/api/endpoints";
import { SessionScorer } from "../skeleton-viewer/utils";

/* ------------------------- CONFIG ------------------------- */

const CALIBRATION_LEVEL_ID = "689ee1a1496c9be0a9a62c9c";

// Your manually marked move times (ms)
const MANUAL_EVENTS_MS: number[] = [
  1500, 4900, 9000, 12500, 15000, 20500, 22000, 23500, 25000,
];

// "Success" threshold for the rolling score after each move
const SCORE_THRESHOLD = 95;
// Count a crossing only within this window after each move (ms)
const MAX_WINDOW_MS = 2000;
// Minimum spacing between events after sanitization (ms)
const MIN_EVENT_GAP_MS = 300;

// Webcam preview size
const FEED_SIZE = 500;

/* ---------------------- HELPERS ------------------- */

function sanitizeEvents(arr: number[], minGapMs = MIN_EVENT_GAP_MS): number[] {
  const a = [...new Set(arr)].sort((x, y) => x - y);
  const out: number[] = [];
  for (const t of a) if (!out.length || t - out[out.length - 1] >= minGapMs) out.push(t);
  return out;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function quantile(arr: number[], q: number) {
  const a = [...arr].sort((x,y)=>x-y);
  if (!a.length) return 0;
  const idx = (a.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
function medianAbsoluteDeviation(arr: number[]) {
  const m = quantile(arr, 0.5);
  const dev = arr.map(x => Math.abs(x - m));
  return quantile(dev, 0.5);
}

function setCalibrationOffsetMs(ms: number) {
  localStorage.setItem("dance.calibrationOffsetMs", String(ms));
}

/* ------------------------ PAGE --------------------------- */

export default function CalibrationPage() {
  const nav = useNavigate();
  const { objectId } = useParams();             // optional override
  const levelId = objectId || CALIBRATION_LEVEL_ID;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scorerRef = useRef<SessionScorer | null>(null);
  const scoreSamples = useRef<{ t: number; s: number }[]>([]);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "countdown" | "running" | "done">("idle");
  const [msg, setMsg] = useState<string>("");
  const [annotatedUrl, setAnnotatedUrl] = useState<string>("");
  const [levelData, setLevelData] = useState<LevelData | null>(null);
  const [events, setEvents] = useState<number[]>([]);
  const [liveScore, setLiveScore] = useState<number>(0);  // 0–100
  const [countdown, setCountdown] = useState<number | null>(null);
  const [result, setResult] = useState<{ offsetMs: number; used: number; total: number; median: number; mad: number } | null>(null);

  // Load level + video
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [videoUrl, lvl] = await Promise.all([
          endpoints.getAnnotatedVideo(levelId), // returns a URL in your project
          endpoints.getLevel(levelId),
        ]);
        setAnnotatedUrl(videoUrl);
        setLevelData(lvl);
        setEvents(sanitizeEvents(MANUAL_EVENTS_MS));
      } catch (e: any) {
        setMsg(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [levelId]);

  // Pose callback → feed SessionScorer + record rolling score vs video time
  const onPose = (data: TimestampedPoses) => {
    if (status !== "running" || !videoRef.current || !scorerRef.current) return;

    // use the reference video clock for alignment
    const t = Math.round(videoRef.current.currentTime * 1000);

    const scoreObj: any = scorerRef.current.consumePose(data, t);
    let s = typeof scoreObj?.total === "number" ? scoreObj.total : 0;

    // Normalize to 0–100 if scorer emits 0–1
    if (s <= 1.0001) s *= 100;

    s = Math.max(0, Math.min(100, s));
    scoreSamples.current.push({ t, s });
    setLiveScore(s);
  };

  const start = async () => {
    if (!annotatedUrl || !videoRef.current || !levelData) return;
    setResult(null);
    scoreSamples.current = [];
    setLiveScore(0);

    // Build a real scorer using your LevelData; cover whole clip
    const durationMsFromVideo = Math.round((videoRef.current.duration || 60) * 1000);
    const endByIntervals = levelData.intervals?.length ? levelData.intervals[levelData.intervals.length - 1][1] : durationMsFromVideo;
    const endMs = Math.max(durationMsFromVideo, endByIntervals || durationMsFromVideo);

    scorerRef.current = new SessionScorer(levelData, 500, [[0, endMs]]);

    // 3-2-1 countdown
    setStatus("countdown");
    for (const n of [3, 2, 1]) {
      setCountdown(n);
      await sleep(1000);
    }
    setCountdown(null);

    setStatus("running");
    const vid = videoRef.current;
    vid.currentTime = 0;
    vid.onended = finish;
    await vid.play();
  };

  const finish = () => {
    setStatus("done");
    const samples = scoreSamples.current.sort((a,b)=>a.t-b.t);
    const { median, mad, used, total } = delayStatsFromEvents(events, samples, SCORE_THRESHOLD, MAX_WINDOW_MS);
    const offsetMs = Math.round(median);
    setCalibrationOffsetMs(offsetMs);
    setResult({ offsetMs, used, total, median, mad });
  };

  const canStart = !!annotatedUrl && !!levelData && !!events.length && (status === "idle" || status === "done");

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 2rem 8rem", color: "#fff" }}>
      <button onClick={() => nav("/")} style={backBtn}>Back</button>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: 12 }}>Calibration (score-based)</h1>

      {loading && <p>Loading…</p>}
      {msg && <p style={{ color: "#ff7676" }}>{msg}</p>}

      {!!events.length && annotatedUrl && (
        <>
          <p>
            Imitate the reference. After each marked move, we measure how long it takes your rolling score to reach{" "}
            <b>{SCORE_THRESHOLD}</b>. The median delay becomes your calibration offset.
          </p>

          <div style={grid2}>
            <div style={panel}>
              <h3 style={h3}>Reference</h3>
              <video
                ref={videoRef}
                src={annotatedUrl}
                controls
                playsInline
                muted
                style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 8 }}
              />
              <p style={{ opacity: 0.85, marginTop: 8 }}>
                Moves: <b>{events.length}</b>
              </p>
            </div>

            {/* Webcam panel with overlay button/countdown */}
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
          </div>

          {/* Fallback button */}
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button onClick={start} disabled={!canStart} style={primary(!canStart)}>
              {status === "running" ? "Calibrating…" : "Start Calibration"}
            </button>
          </div>

          {result && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, background: "#141414" }}>
              <h3 style={{ margin: "0 0 8px 0" }}>Result</h3>
              <p style={{ margin: 0 }}>
                Offset: <b>{result.offsetMs} ms</b> • used {result.used}/{result.total} events • MAD {Math.round(result.mad)} ms
              </p>
              <p style={{ opacity: 0.85, marginTop: 6 }}>
                Positive means your score tends to clear {SCORE_THRESHOLD} about <b>{result.offsetMs} ms</b> after the reference move.
              </p>
              <p style={{ opacity: 0.8, marginTop: 6 }}>
                Saved locally; Game/Feedback should subtract this offset from the user timestamp when scoring.
              </p>
            </div>
          )}
        </>
      )}

      {!loading && !events.length && (
        <p style={{ color: "#ffb86b" }}>
          No event timestamps detected. Check <code>MANUAL_EVENTS_MS</code> at the top of this file.
        </p>
      )}

      {/* Big bottom score banner */}
      <ScoreBanner score={liveScore} />
    </div>
  );
}

/* -------------------- DELAY LOGIC -------------------- */

function delayStatsFromEvents(
  events: number[],
  samples: { t: number; s: number }[],
  thr: number,
  maxWindowMs: number
) {
  const total = events.length;
  const deltas: number[] = [];
  let used = 0;

  if (!total || !samples.length) return { median: 0, mad: 0, used: 0, total };

  samples.sort((a,b)=>a.t-b.t);

  for (const t0 of events) {
    let prevBelow = true;
    let found: number | null = null;

    for (const { t, s } of samples) {
      if (t < t0) { prevBelow = s < thr; continue; }
      if (t > t0 + maxWindowMs) break;
      if (prevBelow && s >= thr) { found = t; break; }
      prevBelow = s < thr;
    }

    if (found != null) {
      deltas.push(found - t0);
      used++;
    }
  }

  const median = deltas.length ? quantile(deltas, 0.5) : 0;
  const mad = deltas.length ? medianAbsoluteDeviation(deltas) : 0;
  return { median, mad, used, total };
}

/* ------------------ SCORE BANNER (Bottom) ----------------- */

function ScoreBanner({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  const txt = clamped.toFixed(2);
  return (
    <div style={scoreWrap}>
      <div style={scoreText}>{txt}</div>
    </div>
  );
}

/* ----------------------- STYLES ----------------------- */

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 };
const panel: React.CSSProperties = { background: "#141414", border: "1px solid #2a2a2a", borderRadius: 12, padding: 12 };
const h3: React.CSSProperties = { fontSize: "1.05rem", fontWeight: 600, margin: "0 0 6px 0", opacity: 0.9 };
const backBtn: React.CSSProperties = { position: "absolute", top: "1rem", left: "1rem", padding: "0.5rem 1rem", background: "#6c757d", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" };
const primary = (disabled:boolean): React.CSSProperties => ({ padding: "10px 16px", background: disabled ? "#6c757d" : "#007bff", color:"#fff", border:"none", borderRadius: 6, cursor: disabled ? "default" : "pointer", fontWeight:600 });

const overlayShade: React.CSSProperties = {
  position: "absolute",
  inset: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.35)",
  borderRadius: 8,
  zIndex: 2,
};

const ctaBtn: React.CSSProperties = {
  padding: "14px 22px",
  background: "#00b894",
  color: "#0b0b0b",
  border: "none",
  borderRadius: 999,
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
  right: 20,
  top: 20,
  background: "#007bff",
  color: "#fff",
  padding: "6px 10px",
  borderRadius: 999,
  fontWeight: 700,
  zIndex: 2,
};

// full-width black bar stuck to bottom
const scoreWrap: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  background: "#000",
  minHeight: 110,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 999,
};
const scoreText: React.CSSProperties = {
  color: "#fff",
  fontSize: 64,
  fontWeight: 800,
  letterSpacing: 0.5,
  fontVariantNumeric: "tabular-nums",
  textAlign: "center",
};
