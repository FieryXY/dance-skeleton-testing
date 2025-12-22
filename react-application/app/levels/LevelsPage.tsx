import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import endpoints from "~/api/endpoints";
import type { LevelListItem } from "~/api/endpoints";

export default function LevelsPage() {
  const navigate = useNavigate();

  const [levels, setLevels] = useState<LevelListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isCalibrationLevel = (levelTitle: string | undefined | null) => {
    return (levelTitle ?? "").trim().toLowerCase() === "calibration";
  };

  const visibleLevels = useMemo(() => {
    return levels.filter(level => !isCalibrationLevel(level.title));
  }, [levels]);

  const refresh = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const items = await endpoints.listLevels();
      setLevels(items);
    } catch (err: any) {
      setLoadError(err?.message ?? String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem", color: "#fff" }}>
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

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>Levels</h1>
        <button
          onClick={() => navigate("/level-creation")}
          style={{
            padding: "0.75rem 1.25rem",
            backgroundColor: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Create Level
        </button>
      </div>

      {/* List */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "bold" }}>All created levels</h2>
          <button
            onClick={refresh}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: isLoading ? "#6c757d" : "#28a745",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: isLoading ? "default" : "pointer",
            }}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {loadError && <div style={{ color: "#ff6b6b", marginBottom: "1rem" }}>Failed to load levels: {loadError}</div>}

        {isLoading && visibleLevels.length === 0 ? (
          <div>Loading...</div>
        ) : visibleLevels.length === 0 ? (
          <div>No levels yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {visibleLevels.map(level => (
              <button
                key={level.id}
                onClick={() => navigate(`/play/${level.id}`)}
                style={{
                  textAlign: "left",
                  padding: "0.75rem 1rem",
                  borderRadius: 8,
                  border: "1px solid #333",
                  backgroundColor: "#111",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: "bold" }}>{level.title || "Untitled"}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
