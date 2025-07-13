import * as poseDetection from '@tensorflow-models/pose-detection';
import type { ScoredPose } from '~/skeleton-viewer/utils';
const BackendURL = import.meta.env.REACT_APP_BACKEND_URL;

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
    recommendations: ProcessedFeedbackRecommendation[];
}

class Endpoints {
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

    getFeedback = (objectId: string, video: File, startTimestamp: number, endTimestamp: number, poses: ScoredPose[], average_scores: Record<string, number>): Promise<FeedbackResponse> => {
        const formData = new FormData();
        formData.append("video", video);

        const jsonData = {
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp,
            scoreData: average_scores,
            timestampMappings: poses.map(pose => ({
                originalTimestamp: pose.originalTimestamp,
                mappedTimestamp: pose.webcamTimestamp,
            }))
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
}

const instance = new Endpoints();
export default instance;