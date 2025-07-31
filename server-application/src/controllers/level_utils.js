import Constants from "../constants.js";
import * as poseDetection from '@tensorflow-models/pose-detection';
import ffmpeg from 'fluent-ffmpeg';
import mongoose from "mongoose";
import temp from "temp";
import * as fs from 'fs';
export function drawResults(poses, ctx, model) {
    for (const pose of poses) {
        drawKeypoints(pose.keypoints, ctx);
        drawSkeleton(pose.keypoints, ctx, model);
    }
}
export function drawKeypoints(keypoints, ctx) {
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
export function drawSkeleton(keypoints, ctx, model) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    const adjacentPairs = poseDetection.util.getAdjacentPairs(model);
    for (const [i, j] of adjacentPairs) {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];
        if (!kp1.score || !kp2.score) {
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
export function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err)
                return reject(err);
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (!videoStream)
                return reject(new Error('No video stream found'));
            if (!videoStream.avg_frame_rate)
                return reject(new Error('Average frame rate not given by ffprobe'));
            const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
            const fps = num / den;
            resolve({ fps, width: videoStream.width, height: videoStream.height });
        });
    });
}
export function getTimestampMapping(originalTimestamp, feedbackRequest) {
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
        }
        else if (mappings[mid].originalTimestamp < originalTimestamp) {
            left = mid + 1;
        }
        else {
            right = mid - 1;
        }
    }
    if (minDiff > Constants.MAX_TIMESTAMP_MAPPING_DIFF) {
        return null;
    }
    return mappings[closestIdx].mappedTimestamp;
}
export function convertToMp4(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .output(outputPath)
            .on('end', () => {
            resolve();
        })
            .on('error', (err) => {
            reject(err);
        })
            .run();
    });
}
export function trimVideo(inputPath, outputPath, startTimestamp, endTimestamp) {
    const startSec = startTimestamp / 1000;
    const durationSec = (endTimestamp - startTimestamp) / 1000;
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setStartTime(startSec)
            .setDuration(durationSec)
            .output(outputPath)
            .on('end', () => {
            resolve();
        })
            .on('error', (err) => {
            reject(err);
        })
            .run();
    });
}
export async function prepareFeedbackBase64s(objectId, uploadedFilePath, startTimestamp, endTimestamp, playbackRate) {
    if (!mongoose.connection.db) {
        throw new Error("Error connecting with database");
    }
    // Convert the uploaded video to mp4
    const tempUploadedPath = temp.path({ suffix: '.mp4' });
    await convertToMp4(uploadedFilePath, tempUploadedPath);
    // Get the base64 encoding for the uploaded video
    const uploadedVideoBase64 = fs.readFileSync(tempUploadedPath, { encoding: 'base64' });
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
    // Extract only the portion of the video from beginningTimestamp to endTimestamp (in ms)
    const originalVideoBuffer = await new Promise((resolve, reject) => {
        const stream = bucket.openDownloadStreamByName("ORIGINAL_" + objectId);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
    // Write buffer to a temp file
    const tempInput = temp.path({ suffix: '.mp4' });
    const tempInputPlaybackAdjusted = temp.path({ suffix: '.mp4' });
    const tempOutput = temp.path({ suffix: '.mp4' });
    fs.writeFileSync(tempInput, originalVideoBuffer);
    // Change the playback rate of the original video in the temp mp4 file
    console.log(`Adjusting playback rate to ${playbackRate}x for video at ${tempInput}`);
    await new Promise((resolve, reject) => {
        ffmpeg(tempInput)
            .videoFilters(`setpts=${1 / playbackRate}*PTS`)
            .output(tempInputPlaybackAdjusted)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
    });
    // Get the part of the video from startTimestamp to endTimestamp
    await trimVideo(tempInputPlaybackAdjusted, tempOutput, startTimestamp, endTimestamp);
    // Read the trimmed video and encode to base64
    const trimmedVideoBuffer = fs.readFileSync(tempOutput);
    const originalVideoBase64 = trimmedVideoBuffer.toString('base64');
    // Clean up temp files
    temp.cleanupSync();
    return { originalVideoBase64, uploadedVideoBase64 };
}
