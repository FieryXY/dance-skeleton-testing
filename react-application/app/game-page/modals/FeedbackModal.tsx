import React, { useState, useRef, useEffect, useCallback } from "react";
import type { FeedbackResponse, ProcessedFeedbackRecommendation } from "~/api/endpoints"

interface FeedbackModalProps {
	feedbackData: FeedbackResponse;
	onFeedbackModalClose: () => void;
	onRecommendationSelect: (recommendation: ProcessedFeedbackRecommendation) => void;
};

export default function FeedbackModal({
	feedbackData,
	onFeedbackModalClose,
	onRecommendationSelect,
}: FeedbackModalProps) {

  // Helper to format milliseconds into mm:ss:ms (e.g., 01:23:456)
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const milliseconds = Math.floor(ms % 1000).toString().padStart(3, '0');
    return `${minutes}:${seconds}:${milliseconds}`;
  };

	return (
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
													onRecommendationSelect(rec);
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
              onClick={() => { onFeedbackModalClose(); }}
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
      );
}
