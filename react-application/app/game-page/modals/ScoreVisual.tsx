/**
 * ScoreVisual.tsx
 *
 * BlazePose-ish skeleton with clickable angle vertices.
 * Click a vertex to select that angle; chart + average update.
 * "Show overall" returns to total.
 */

import React, { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

import type { ScoredPose } from "../../skeleton-viewer/utils";
import { SessionScorer, angles_to_consider } from "../../skeleton-viewer/utils";

ChartJS.register(
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler
);

type Props = {
  scorer: SessionScorer | null;
  title?: string;
};

function lerpColor(a: [number, number, number], b: [number, number, number], t: number) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function scoreToColor(norm: number) {
  const red: [number, number, number] = [231, 76, 60];
  const green: [number, number, number] = [46, 204, 113];
  const t = Math.max(0, Math.min(1, norm));
  return lerpColor(red, green, t);
}

// A simple 2D "BlazePose-ish" stick layout (not live pose coords)
// You can tweak these to match your preferred look.
type Pt = { x: number; y: number };

const BLAZEPOSE_LAYOUT: Record<string, Pt> = {
  // head-ish (not used by angles, but drawn)
  nose: { x: 110, y: 30 },

  left_shoulder: { x: 85, y: 70 },
  right_shoulder: { x: 135, y: 70 },

  left_elbow: { x: 65, y: 105 },
  right_elbow: { x: 155, y: 105 },

  left_wrist: { x: 55, y: 145 },
  right_wrist: { x: 165, y: 145 },

  left_hip: { x: 95, y: 125 },
  right_hip: { x: 125, y: 125 },

  left_knee: { x: 90, y: 175 },
  right_knee: { x: 130, y: 175 },

  left_ankle: { x: 85, y: 220 },
  right_ankle: { x: 135, y: 220 },
};

// BlazePose-like edges (subset that we draw)
const SKELETON_EDGES: Array<[string, string]> = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

function getVertexKeypoint(angleName: string): string | null {
  const spec = angles_to_consider?.[angleName];
  if (!spec?.keypoints || spec.keypoints.length < 2) return null;
  // Angle is at the middle keypoint [a, V, c]
  return spec.keypoints[1] ?? null;
}

const ScoreVisual: React.FC<Props> = ({ scorer, title = "Session Information" }) => {
  if (!scorer) return <div>Invalid Data</div>;

  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);

  const allScoredPoses = useMemo((): ScoredPose[] => scorer.getTimestampScores() || [], [scorer]);

  const baseTs = useMemo(
    () => (allScoredPoses.length ? allScoredPoses[0].originalTimestamp : 0),
    [allScoredPoses]
  );

  const totalPoints = useMemo(() => {
    if (allScoredPoses.length === 0) return [] as { x: number; y: number; raw?: ScoredPose }[];
    return allScoredPoses.map((s) => ({
      x: (s.originalTimestamp - baseTs) / 1000,
      y: Number(s.scores?.["total"] ?? 0),
      raw: s,
    }));
  }, [allScoredPoses, baseTs]);

  const activePoints = useMemo(() => {
    if (!selectedJoint) return totalPoints;
    return allScoredPoses.map((s) => ({
      x: (s.originalTimestamp - baseTs) / 1000,
      y: Number(s.scores?.[selectedJoint] ?? 0),
      raw: s,
    }));
  }, [allScoredPoses, baseTs, selectedJoint, totalPoints]);

  const scores = useMemo(() => activePoints.map((p) => p.y), [activePoints]);

  const computedAvg = useMemo(() => {
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [scores]);

  const min = useMemo(() => (scores.length ? Math.min(...scores) : 0), [scores]);
  const max = useMemo(() => (scores.length ? Math.max(...scores) : 1), [scores]);

  const normalize = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const pointColors = useMemo(() => scores.map((s) => scoreToColor(normalize(s))), [scores, min, max]);

  const data = useMemo(
    () => ({
      datasets: [
        {
          label: selectedJoint ? `${selectedJoint} score` : "Score",
          data: activePoints,
          fill: true,
          backgroundColor: "rgba(75,139,245,0.08)",
          borderColor: "rgba(75,139,245,0.9)",
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: pointColors,
          pointBorderColor: "rgba(255,255,255,0.6)",
          pointBorderWidth: 1,
        } as any,
      ],
    }),
    [activePoints, pointColors, selectedJoint]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest" as const,
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: any[]) => {
              const item = items?.[0];
              const x = item?.parsed?.x ?? item?.raw?.x ?? null;
              return x != null ? `Time: ${Number(x).toFixed(2)}s` : "";
            },
            label: (item: any) => {
              const v = item.formattedValue ?? item.parsed?.y ?? item.raw?.y;
              return `Score: ${v}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear" as const,
          display: true,
          title: { display: true, text: "Time (s)" },
          grid: { display: false },
          ticks: { callback: (value: number | string) => `${Number(value).toFixed(1)}s` },
          min: 0,
        },
        y: {
          display: true,
          title: { display: true, text: "Score" },
          suggestedMin: Math.max(0, min - (max - min) * 0.1),
          suggestedMax: max + (max - min) * 0.1,
        },
      },
    }),
    [min, max]
  );

  const angleNames = useMemo(() => Object.keys(angles_to_consider || {}), []);
  const hotspots = useMemo(() => {
    return angleNames
      .map((angleName) => {
        const vertex = getVertexKeypoint(angleName);
        if (!vertex) return null;
        const pt = BLAZEPOSE_LAYOUT[vertex];
        if (!pt) return null;
        return { angleName, vertexKeypoint: vertex, ...pt };
      })
      .filter(Boolean) as Array<{ angleName: string; vertexKeypoint: string; x: number; y: number }>;
  }, [angleNames]);

  const selectAngle = (angleName: string) => {
    setSelectedJoint((prev) => (prev === angleName ? null : angleName));
  };

  return (
    <div style={{ width: "100%", minHeight: 220, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ fontSize: 14, color: "#333" }}>
          {selectedJoint ? `${selectedJoint} average:` : "Overall average:"}{" "}
          <strong>{computedAvg.toFixed(2)}</strong>
        </div>
      </div>

      <div style={{ flex: 1, height: 220 }}>
        <Line options={options} data={data} />
      </div>

      {/* BlazePose-ish skeleton with angle hotspots */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <svg width={260} height={300} viewBox="0 0 220 260" style={{ background: "transparent" }}>
          {/* Head */}
          <circle cx={BLAZEPOSE_LAYOUT.nose.x} cy={BLAZEPOSE_LAYOUT.nose.y} r={16} fill="#fff" opacity={0.06} stroke="#ccc" />

          {/* Skeleton edges */}
          {SKELETON_EDGES.map(([a, b]) => {
            const p1 = BLAZEPOSE_LAYOUT[a];
            const p2 = BLAZEPOSE_LAYOUT[b];
            if (!p1 || !p2) return null;
            return <line key={`${a}-${b}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#ccc" strokeWidth={3} />;
          })}

          {/* Clickable hotspots for EACH ANGLE in angles_to_consider (placed at vertex keypoint) */}
          {hotspots.map((h) => {
            const isActive = selectedJoint === h.angleName;
            return (
              <g key={h.angleName} onClick={() => selectAngle(h.angleName)} style={{ cursor: "pointer" }}>
                {/* big invisible hit area */}
                <circle cx={h.x} cy={h.y} r={16} fill="transparent" />

                {/* visible dot */}
                <circle
                  cx={h.x}
                  cy={h.y}
                  r={8}
                  fill={isActive ? "rgba(13,110,253,0.95)" : "rgba(255,255,255,0.38)"}
                  stroke={isActive ? "#ffffff" : "rgba(255,255,255,0.6)"}
                  strokeWidth={2}
                />

                {/* optional small label on hover via <title> */}
                <title>{h.angleName}</title>
              </g>
            );
          })}
        </svg>

        {/* Single bottom button to return to total */}
        {selectedJoint && (
          <button
            onClick={() => setSelectedJoint(null)}
            style={{
              marginTop: 4,
              padding: "8px 12px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid #fff",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Show overall
          </button>
        )}
      </div>
    </div>
  );
};

export default ScoreVisual;
