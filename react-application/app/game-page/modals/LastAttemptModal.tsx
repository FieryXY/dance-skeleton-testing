import React, { useState, useRef, useEffect, useCallback } from "react";

interface LastAttemptModalProps {
	lastAttemptModalVideoUrl: string;
	onLastAttemptModalClose: () => void;
};

export default function LastAttemptModal({
	lastAttemptModalVideoUrl,
	onLastAttemptModalClose,
}: LastAttemptModalProps) {
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
				<h2 style={{ marginTop: 0, fontSize: "1.8rem", fontWeight: "bold" }}>Last Attempt</h2>
				<video
					src={lastAttemptModalVideoUrl}
					controls
					style={{ width: "100%", borderRadius: "8px", marginTop: "1rem" }}
				/>
				<button
					onClick={() => {
						onLastAttemptModalClose();
					}}
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
