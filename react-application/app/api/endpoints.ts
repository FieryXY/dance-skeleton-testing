    import * as poseDetection from '@tensorflow-models/pose-detection';
import type { ScoredPose } from '~/skeleton-viewer/utils';
const BackendURL =
    import.meta.env.VITE_BACKEND_URL ??
    import.meta.env.REACT_APP_BACKEND_URL ??
    "http://localhost:5001";

export interface LevelData {
    title: string;
    intervals: number[][];
    pose_data: TimestampedPoses[];
}

export interface TimestampedPoses {
    poses: poseDetection.Pose[],
    timestamp: number,
}

export interface LevelCreationData {
    title: string,
    intervals: number[][],
    interval_notes?: string[],
}

export interface LevelListItem {
    id: string;
    title: string;
}

export interface ProcessedFeedbackRecommendation {
    title: string;
    description: string;
    startTimestamp?: number;
    endTimestamp?: number;
    mappedStartTimestamp?: number;
    mappedEndTimestamp?: number;
}

export interface FeedbackResponse {
    dialogHeader: string;
    description: string;
    recommendations: ProcessedFeedbackRecommendation[];
}

export interface MiniFeedbackResponse {
    description: string;
    sufficient: boolean;
}

class Endpoints {
    listLevels = (): Promise<LevelListItem[]> => {
        return fetch(`${BackendURL}/levels`)
            .then(async response => {
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Network response was not ok: ${errorText}`);
                }

                const contentType = response.headers.get("content-type") ?? "";
                if (!contentType.includes("application/json")) {
                    const text = await response.text();
                    throw new Error(
                        `Expected JSON from ${BackendURL}/levels but got '${contentType}'. ` +
                        `This usually means the backend URL is misconfigured (set VITE_BACKEND_URL). ` +
                        `Response started with: ${JSON.stringify(text.slice(0, 60))}`
                    );
                }

                return (await response.json()) as LevelListItem[];
            })
            .catch(error => {
                console.error("Error listing levels:", error);
                throw error;
            });
    }

    getLevel = (objectId: string): Promise<LevelData> => {
        return fetch(`${BackendURL}/levels/${objectId}`)
            .then(response => response.json())
            .then(data => data as LevelData)
            .catch(error => {
                console.error("Error fetching level:", error);
                throw error;
            });
    }

    getOriginalVideo = (objectId: string): Promise<string> => {
        return fetch(`${BackendURL}/levels/getVideo/${objectId}`)
            .then(async response => {
                if (!response.ok) {
                    throw new Error("Network response was not ok");
                }

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                return url;
            })
            .catch(error => {
                console.error("Error fetching original video:", error);
                throw error;
            });
    }

    getAnnotatedVideo = (objectId: string): Promise<string> => {
        return fetch(`${BackendURL}/levels/getAnnotatedVideo/${objectId}`)
            .then(response => response.blob())
            .then(blob => URL.createObjectURL(blob))
            .catch(error => {
                console.error("Error fetching annotated video:", error);
                throw error;
            });
    }


    createLevel = (video: File, data: LevelCreationData): Promise<string> => {
        const formData = new FormData();
        formData.append("video", video);
        formData.append("data", JSON.stringify(data));

        return fetch(`${BackendURL}/levels/create`, {
            method: "POST",
            body: formData,
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${errorText}`);
            }
            
            const text = await response.text();
            return text;
        })
        .catch(error => {
            console.error("Error creating level:", error);
            throw error;
        });
    }

    getFeedback = (objectId: string, video: File, startTimestamp: number, endTimestamp: number, poses: ScoredPose[], average_scores: Record<string, number>, playbackRate: number): Promise<FeedbackResponse> => {
        const formData = new FormData();
        formData.append("video", video);

        const jsonData = {
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp,
            scoreData: average_scores,
            timestampMappings: poses.map(pose => ({
                originalTimestamp: pose.originalTimestamp,
                mappedTimestamp: pose.webcamTimestamp,
            })),
            playbackRate: playbackRate,
        }

        formData.append("data", JSON.stringify(jsonData));

        return fetch(`${BackendURL}/levels/getFeedback/${objectId}`, {
            method: "POST",
            body: formData,
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${errorText}`);
            }
            
            const text = await response.json();
            return text as FeedbackResponse;
        })
        .catch(error => {
            console.error("Error creating level:", error);
            throw error;
        });
    }

    getMiniFeedback = (objectId: string, video: File, previousVideo: File, startTimestamp: number, endTimestamp: number, originalRecommendation: string, playbackRate: number): Promise<MiniFeedbackResponse> => {
        const formData = new FormData();
        formData.append("video", video);
        formData.append("previousVideo", previousVideo);

        const jsonData =  {
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp,
            originalRecommendation: originalRecommendation,
            playbackRate: playbackRate,
        }

        formData.append("data", JSON.stringify(jsonData));

        return fetch(`${BackendURL}/levels/getMiniFeedback/${objectId}`, {
            method: "POST",
            body: formData,
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${errorText}`);
            }

            const text = await response.json();
            return text as MiniFeedbackResponse;
        })
        .catch(error => {
            console.error("Error getting mini feedback:", error);
            throw error;
        });
    }
    
    trimVideo = (video: File, startTimestamp: number, endTimestamp: number): Promise<File> => {
        const formData = new FormData();
        formData.append("video", video);
        
        const jsonData = {
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp,
        }

        formData.append("data", JSON.stringify(jsonData));

        return fetch(`${BackendURL}/videos/trim`, {
            method: "POST",
            body: formData,
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${errorText}`);
            }

            // const blob = await response.blob();
            // return new File([blob], video.name, { type: video.type });

            // Returns a JSON with a key "trimmedVideoBase64"
            const data = await response.json();
            const base64String = data.trimmedVideoBase64 as string;

            // Convert base64 string back to File
            const byteCharacters = atob(base64String);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const trimmedVideoFile = new File([byteArray], video.name, { type: video.type });
            
            return trimmedVideoFile;
        })
        .catch(error => {
            console.error("Error trimming video:", error);
            throw error;
        });
    }
    addInterval = (levelId: string, startTimestamp: number, endTimestamp: number): Promise<LevelData> => {
        return fetch(`${BackendURL}/levels/${levelId}/intervals`, {
            method: "PUT",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ startTimestamp, endTimestamp }),
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${errorText}`);
            }
            return response.json() as Promise<LevelData>;
        })
        .catch(error => {
            console.error("Error adding interval:", error);
            throw error;
        });
    }
    deleteInterval = (levelId: string, intervalIndex: number): Promise<LevelData> => {
        return fetch(`${BackendURL}/levels/${levelId}/intervals/${intervalIndex}`, {
            method: "DELETE",
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${errorText}`);
            }
            return response.json() as Promise<LevelData>;
        })
        .catch(error => {
            console.error("Error deleting interval:", error);
            throw error;
        });
    }
}
const instance = new Endpoints();
export default instance;