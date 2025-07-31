import React, { useRef, useState } from "react";
import { useNavigate } from "react-router";
import endpoints from "~/api/endpoints";
import type { LevelCreationData } from "~/api/endpoints";

export default function LevelCreationPage() {
    const navigate = useNavigate();

    // Form state
    const [title, setTitle] = useState<string>("");
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoURL, setVideoURL] = useState<string | null>(null);
    const [intervals, setIntervals] = useState<number[][]>([]);
    const [intervalNotes, setIntervalNotes] = useState<string[]>([]);

    // Interval temp state
    const [pendingStart, setPendingStart] = useState<number | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);

    // Loading state for creation request
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVideoFile(file);
            const url = URL.createObjectURL(file);
            setVideoURL(url);
        }
    };

    const currentTimeMs = () => (videoRef.current ? videoRef.current.currentTime * 1000 : 0);

    const handleStartInterval = () => {
        setPendingStart(currentTimeMs());
    };

    const handleEndInterval = () => {
        if (pendingStart === null) return;
        const end = currentTimeMs();
        if (end <= pendingStart) {
            alert("End time must be after start time");
            return;
        }
        setIntervals(prev => [...prev, [Math.round(pendingStart), Math.round(end)]]);
        setIntervalNotes(prev => [...prev, ""]);
        setPendingStart(null);
    };

    const deleteInterval = (idx: number) => {
        setIntervals(prev => prev.filter((_, i) => i !== idx));
        setIntervalNotes(prev => prev.filter((_, i) => i !== idx));
    };

    const handleSubmit = async () => {
        if (!videoFile) {
            alert("Please upload a video");
            return;
        }
        if (!title.trim()) {
            alert("Please enter a title");
            return;
        }
        if (intervals.length === 0 && !confirm("No intervals defined. Create level without intervals?")) {
            return;
        }

        const data: LevelCreationData = { title, intervals, interval_notes: intervalNotes };

        setIsLoading(true);
        try {
            const id = await endpoints.createLevel(videoFile, data);
            alert(`Level created with ID: ${id}`);

            // Reset
            setTitle("");
            setVideoFile(null);
            setVideoURL(null);
            setIntervals([]);
            setIntervalNotes([]);
        } catch (err: any) {
            alert(`Error creating level: ${err.message || err}`);
        } finally {
            setIsLoading(false);
        }
    };

    /* ------------------ UI ------------------ */
    return (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem", color: "#fff" }}>
            {/* Back Button */}
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

            <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "1rem" }}>Create New Level</h1>

            <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Title:
                <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    style={{ 
                        width: "100%", 
                        padding: "8px", 
                        marginTop: "4px", 
                        color: "#fff", 
                        backgroundColor: "#222", 
                        border: "1px solid #555" 
                    }}
                />
            </label>

            <label style={{ display: "block", marginBottom: "1rem" }}>
                Upload Video (MP4):
                <input
                    type="file"
                    accept="video/mp4"
                    onChange={handleVideoChange}
                    style={{ display: "block", marginTop: "4px" }}
                />
            </label>

            {videoURL && (
                <div style={{ marginBottom: "1rem" }}>
                    <video
                        src={videoURL}
                        ref={videoRef}
                        controls
                        style={{ width: "100%", maxHeight: 400, backgroundColor: "#000" }}
                    />
                    <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                        <button
                            onClick={handleStartInterval}
                            style={{ flex: 1, padding: "8px", backgroundColor: "#28a745", color: "#fff", border: "none" }}
                        >
                            Mark Start
                        </button>
                        <button
                            onClick={handleEndInterval}
                            style={{ flex: 1, padding: "8px", backgroundColor: "#17a2b8", color: "#fff", border: "none" }}
                        >
                            Mark End
                        </button>
                    </div>
                    {pendingStart !== null && (
                        <p style={{ marginTop: "0.5rem" }}>
                            Interval start set at {(pendingStart / 1000).toFixed(2)}s – play video and click "Mark End" to finish interval.
                        </p>
                    )}
                </div>
            )}

            {intervals.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                    <h2 style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>Intervals</h2>
                    <ul style={{ listStyle: "none", padding: 0 }}>
                        {intervals.map(([s, e], idx) => (
                            <li
                                key={idx}
                                style={{ marginBottom: "0.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                            >
                                <span>
                                    {idx + 1}. {(s / 1000).toFixed(2)}s – {(e / 1000).toFixed(2)}s
                                </span>
                                <div style={{ display: "flex", gap: "0.25rem" }}>
                                    <button
                                        onClick={() => {
                                            if (videoRef.current) {
                                                videoRef.current.currentTime = s / 1000;
                                            }
                                        }}
                                        style={{ padding: "4px 8px", backgroundColor: "#6c757d", color: "#fff", border: "none" }}
                                    >
                                        ↦ Start
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (videoRef.current) {
                                                videoRef.current.currentTime = e / 1000;
                                            }
                                        }}
                                        style={{ padding: "4px 8px", backgroundColor: "#6c757d", color: "#fff", border: "none" }}
                                    >
                                        ↦ End
                                    </button>
                                    <button
                                        onClick={() => deleteInterval(idx)}
                                        style={{ padding: "4px 8px", backgroundColor: "#dc3545", color: "#fff", border: "none" }}
                                    >
                                        Delete
                                    </button>
                                    <input
                                        type="text"
                                        value={intervalNotes[idx]}
                                        onChange={e => setIntervalNotes(prev => {
                                            const next = [...prev];
                                            next[idx] = e.target.value;
                                            return next;
                                        })}
                                        style={{ 
                                            width: "100%", 
                                            padding: "8px", 
                                            marginTop: "4px", 
                                            color: "#fff", 
                                            backgroundColor: "#222", 
                                            border: "1px solid #555" 
                                        }}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <button
                    onClick={handleSubmit}
                    disabled={isLoading}
                    style={{ 
                        padding: "12px 24px", 
                        backgroundColor: isLoading ? "#6c757d" : "#007bff", 
                        color: "#fff", 
                        border: "none", 
                        fontSize: "1rem", 
                        cursor: isLoading ? "default" : "pointer" 
                    }}
                >
                    {isLoading ? "Creating..." : "Create Level"}
                </button>
                {isLoading && (
                    <progress style={{ flex: 1, height: 8 }} />
                )}
            </div>
        </div>
    );
}