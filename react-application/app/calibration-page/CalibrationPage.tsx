import React from "react";
import { useNavigate } from "react-router";

export default function CalibrationPage() {
  const nav = useNavigate();
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem", color: "#fff" }}>
      <button
        onClick={() => nav("/")}
        style={{ position:"absolute", top:"1rem", left:"1rem", padding:"0.5rem 1rem",
                 background:"#6c757d", color:"#fff", border:"none", borderRadius:4, cursor:"pointer" }}
      >
        Back
      </button>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "0.75rem" }}>Calibration</h1>
      <p>Placeholder — wire in the full calibration component here.</p>
    </div>
  );
}