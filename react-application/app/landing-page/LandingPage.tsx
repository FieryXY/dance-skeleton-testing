import React from "react";
import { useNavigate } from "react-router";

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      backgroundColor: "#000", // Match GamePage background color
      padding: "2rem",
    }}>
      {/* Title */}
      <h1 style={{
        fontSize: "4rem",
        fontWeight: "bold",
        color: "#fff", // White text for contrast
        marginBottom: "2rem",
        textAlign: "center",
      }}>
        Dance AI
      </h1>

      {/* Buttons */}
      <div style={{
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
        justifyContent: "center",
      }}>
        <button
          onClick={() => navigate("/levels")}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1.25rem",
            borderRadius: "8px",
            border: "none",
            backgroundColor: "#007bff",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Levels
        </button>
        <button
          onClick={() => navigate("/level-creation")}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1.25rem",
            borderRadius: "8px",
            border: "none",
            backgroundColor: "#28a745",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Create Level
        </button>
        <button
          onClick={() => navigate("/calibration-page")}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1.25rem",
            borderRadius: "8px",
            border: "none",
            backgroundColor: "#ffc107",
            color: "#000",
            cursor: "pointer",
          }}
        >
          Calibrate
        </button>
      </div>
    </div>
  );
}
