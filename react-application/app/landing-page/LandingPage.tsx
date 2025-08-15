import React, { useState } from "react";
import { useNavigate } from "react-router";

export default function LandingPage() {
  const [levelCode, setLevelCode] = useState("");
  const navigate = useNavigate();

  const handlePlay = () => {
    if (levelCode.trim()) {
      navigate(`/play/${levelCode}`);
    } else {
      alert("Please enter a valid level code.");
    }
  };

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

      {/* Level Code Input */}
      <input
        type="text"
        placeholder="Enter Level Code"
        value={levelCode}
        onChange={(e) => setLevelCode(e.target.value)}
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "1rem",
          fontSize: "1.5rem",
          borderRadius: "8px",
          border: "1px solid #ced4da",
          marginBottom: "1.5rem",
          textAlign: "center",
          backgroundColor: "#fff", // White background for the text box
          color: "#000", // Black text for visibility
        }}
      />

      {/* Buttons */}
      <div style={{
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
        justifyContent: "center",
      }}>
        <button
          onClick={handlePlay}
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
          Play
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
