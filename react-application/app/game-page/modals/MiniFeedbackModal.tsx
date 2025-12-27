import React, { useState, useRef, useEffect, useCallback } from "react";
import type { MiniFeedbackResponse } from "~/api/endpoints";

interface MiniFeedbackModalProps {
	miniFeedbackData: MiniFeedbackResponse;
	onFeedbackModalClose: () => void;
};

export default function MiniFeedbackModal({
	miniFeedbackData,
	onFeedbackModalClose,
}: MiniFeedbackModalProps) {
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
				maxWidth: "500px",
				boxShadow: "0 4px 12px rgba(0,0,0,0.7)",
			}}>
				<h2 style={{ marginTop: 0, fontSize: "1.8rem", fontWeight: "bold" }}>Practice Feedback</h2>
				<p style={{ lineHeight: 1.4 }}>{miniFeedbackData.description}</p>
				{miniFeedbackData.sufficient && (
					<p style={{ marginTop: "1rem", color: "#28a745", fontWeight: "bold" }}>Great job! This looks sufficient.</p>
				)}
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
	)
}
