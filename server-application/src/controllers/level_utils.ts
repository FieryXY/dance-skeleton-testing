import { CanvasRenderingContext2D } from "canvas";
import Constants from "../constants.js";
import * as poseDetection from '@tensorflow-models/pose-detection';
import { FeedbackRequest } from "../frontend_models/level_schemas.js";
import ffmpeg from 'fluent-ffmpeg';

export function drawResults(poses: poseDetection.Pose[], ctx: CanvasRenderingContext2D, model: poseDetection.SupportedModels): void {
    for (const pose of poses) {
      drawKeypoints(pose.keypoints, ctx);
      drawSkeleton(pose.keypoints, ctx, model);
    }
  }
  
  export function drawKeypoints(keypoints: poseDetection.Keypoint[], ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'Red';
    ctx.strokeStyle = 'White';
    ctx.lineWidth = 2;
  
    for (const keypoint of keypoints) {
      if (keypoint.score && keypoint.score >= Constants.SCORE_THRESHOLD) {
        ctx.beginPath();
        ctx.arc(keypoint.x, keypoint.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  
  export function drawSkeleton(keypoints: poseDetection.Keypoint[], ctx: CanvasRenderingContext2D, model: poseDetection.SupportedModels) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
  
    const adjacentPairs = poseDetection.util.getAdjacentPairs(model);
  
    for (const [i, j] of adjacentPairs) {
      const kp1 = keypoints[i];
      const kp2 = keypoints[j];
  
      if(!kp1.score || !kp2.score) {
        continue;
      }
  
      if (kp1.score >= Constants.SCORE_THRESHOLD && kp2.score >= Constants.SCORE_THRESHOLD) {
        ctx.beginPath();
        ctx.moveTo(kp1.x, kp1.y);
        ctx.lineTo(kp2.x, kp2.y);
        ctx.stroke();
      }
    }
  }
  
  export function getVideoInfo(inputPath: string): Promise<{fps: number, width: number | undefined, height:number | undefined}> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream) return reject(new Error('No video stream found'));
        if(!videoStream.avg_frame_rate) return reject(new Error('Average frame rate not given by ffprobe'))
  
        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
        const fps = num / den;
        resolve({ fps, width: videoStream.width, height: videoStream.height });
      });
    });
  }
  
  export function getTimestampMapping(originalTimestamp: number, feedbackRequest: FeedbackRequest): number | null {
    if (!feedbackRequest.timestampMappings || feedbackRequest.timestampMappings.length === 0) {
      return null;
    }
  
    const mappings = feedbackRequest.timestampMappings;
    let left = 0;
    let right = mappings.length - 1;
    let closestIdx = 0;
    let minDiff = Math.abs(mappings[0].originalTimestamp - originalTimestamp);
  
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const diff = Math.abs(mappings[mid].originalTimestamp - originalTimestamp);
  
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = mid;
      }
  
      if (mappings[mid].originalTimestamp === originalTimestamp) {
        return mappings[mid].mappedTimestamp;
      } else if (mappings[mid].originalTimestamp < originalTimestamp) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
  
    if(minDiff > Constants.MAX_TIMESTAMP_MAPPING_DIFF) {
      return null;
    }
  
    return mappings[closestIdx].mappedTimestamp;
  }