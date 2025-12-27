import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

const LANDING_MENU_FLIPPED_KEY = "landingMenuFlipped";

export default function LandingPage() {
  const navigate = useNavigate();
  const [isFlipped, setIsFlipped] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const didInitPersistRef = useRef(false);

  const circleSize = useMemo(() => "min(420px, 80vw)", []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(LANDING_MENU_FLIPPED_KEY);
    if (stored === "1") setIsFlipped(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!didInitPersistRef.current) {
      didInitPersistRef.current = true;
      return;
    }
    window.sessionStorage.setItem(LANDING_MENU_FLIPPED_KEY, isFlipped ? "1" : "0");
  }, [isFlipped]);

  const handleFrontClick = () => {
    if (isPressed || isFlipped) return;
    setIsPressed(true);
    window.setTimeout(() => setIsPressed(false), 140);
    window.setTimeout(() => setIsFlipped(true), 180);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#000",
        padding: "2rem",
      }}
    >
      <style>
        {`
          .landingPerspective { perspective: 1200px; }
          .landingCard {
            width: ${circleSize};
            height: ${circleSize};
          }
          .landingInner {
            position: relative;
            width: 100%;
            height: 100%;
            transform-style: preserve-3d;
            transition: transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
          }
          .landingInner.isFlipped { transform: rotateY(180deg); }
          .landingInner.isPressed { transform: scale(0.985); }
          .landingFace {
            position: absolute;
            inset: 0;
            border-radius: 9999px;
            border: 2px solid rgba(255, 255, 255, 0.9);
            background: #000;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
          }
          .landingFace.front {
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .landingFace.back {
            transform: rotateY(180deg);
            display: flex;
            align-items: center;
            justify-content: center;
          }
        `}
      </style>

      <div className="landingPerspective">
        <div className="landingCard">
          <div className={`landingInner ${isFlipped ? "isFlipped" : ""} ${isPressed ? "isPressed" : ""}`}>
            {/* Front: welcome circle */}
            <div className="landingFace front">
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "2.5rem",
                  boxSizing: "border-box",
                  color: "#fff",
                  textAlign: "center",
                  userSelect: "none",
                }}
              >
                <div>
                  <div style={{ fontSize: "3rem", fontWeight: "bold", lineHeight: 1.1 }}>Stepsense</div>
                  <div style={{ marginTop: "0.75rem", opacity: 0.7 }}>Click to start</div>
                </div>
              </div>

              <button
                type="button"
                aria-label="Open menu"
                onClick={handleFrontClick}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              />
            </div>

            {/* Back: existing 3 buttons (unchanged) */}
            <div className="landingFace back">
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "1rem",
                  padding: "2.5rem",
                  boxSizing: "border-box",
                }}
              >
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

                <button
                  type="button"
                  onClick={() => setIsFlipped(false)}
                  style={{
                    position: "absolute",
                    right: "1.25rem",
                    bottom: "1.25rem",
                    background: "transparent",
                    border: "none",
                    color: "rgba(255, 255, 255, 0.75)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "0.95rem",
                  }}
                >
                  ← Back
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
