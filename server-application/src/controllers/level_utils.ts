import { CanvasRenderingContext2D } from "canvas";
import Constants from "../constants.js";
import * as poseDetection from '@tensorflow-models/pose-detection';
import { FeedbackRequest } from "../frontend_models/level_schemas.js";
import ffmpeg from 'fluent-ffmpeg';
import mongoose, { mongo } from "mongoose";
import temp from "temp";
import * as fs from 'fs';
import { Readable } from "stream";

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

export function convertToMp4(inputPath: string, outputPath: string): Promise<void> {
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

  export function trimVideo(inputPath: string, outputPath: string, startTimestamp: number, endTimestamp: number): Promise<void> {
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

  export async function prepareFeedbackBase64s(objectId: string, uploadedFilePath: string, startTimestamp: number, endTimestamp: number, playbackRate: number, slowFactor: number = 1): Promise<{originalVideoBase64: string, uploadedVideoBase64: string}> {
    if(!mongoose.connection.db) {
        throw new Error("Error connecting with database");
    }

  // Convert the uploaded video to mp4
  const tempUploadedPath = temp.path({ suffix: '.mp4' });
  await convertToMp4(uploadedFilePath, tempUploadedPath);

  // If we need to adjust playback (including an extra slowFactor), create an adjusted uploaded file
  let finalUploadedPath = tempUploadedPath;
  const safePlaybackRate = (playbackRate && playbackRate > 0) ? playbackRate : 1;
  const appliedSetpts = slowFactor * (1 / safePlaybackRate);
  if (appliedSetpts !== 1) {
    const tempUploadedPlaybackAdjusted = temp.path({ suffix: '.mp4' });
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempUploadedPath)
        .videoFilters(`setpts=${appliedSetpts}*PTS`)
        // drop audio to avoid extremely slow audio artifacts
        .noAudio()
        .output(tempUploadedPlaybackAdjusted)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
    finalUploadedPath = tempUploadedPlaybackAdjusted;
  }

  // Get the base64 encoding for the uploaded video (possibly playback-adjusted)
  const uploadedVideoBase64 = fs.readFileSync(finalUploadedPath, { encoding: 'base64' });

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);

     // Extract only the portion of the video from beginningTimestamp to endTimestamp (in ms)
     const originalVideoBuffer: Buffer = await new Promise((resolve, reject) => {
        const stream = bucket.openDownloadStreamByName("ORIGINAL_" + objectId);
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });

      // Write buffer to a temp file
    const tempInput = temp.path({ suffix: '.mp4' });
    const tempInputTrimmed = temp.path({ suffix: '.mp4' });
    const tempOutput = temp.path({ suffix: '.mp4' });
    fs.writeFileSync(tempInput, originalVideoBuffer);

    // Get the part of the video from startTimestamp to endTimestamp
    await trimVideo(tempInput, tempInputTrimmed, startTimestamp, endTimestamp);

    // Change the playback rate of the original video in the temp mp4 file.
    // We apply both the requested playbackRate and the extra slowFactor so callers can ask for
    // a combined adjustment (e.g. slowFactor=100 to slow 100x before sending to Gemini).
    const safePlaybackRate2 = (playbackRate && playbackRate > 0) ? playbackRate : 1;
    const appliedSetptsOriginal = slowFactor * (1 / safePlaybackRate2);
    console.log(`Adjusting playback rate (setpts=${appliedSetptsOriginal}) for video at ${tempInput}`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempInputTrimmed)
        .videoFilters(`setpts=${appliedSetptsOriginal}*PTS`)
        // drop audio to avoid extremely slow audio artifacts
        .noAudio()
        .output(tempOutput)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    // Read the trimmed video and encode to base64
    const finalOriginalVideoBuffer = fs.readFileSync(tempOutput);
    const originalVideoBase64 = finalOriginalVideoBuffer.toString('base64');

    // Clean up temp files
    temp.cleanupSync();

    return {originalVideoBase64, uploadedVideoBase64};
  }

  /**
   * 
   * @param videoBase641 Base 64 encoded video 1
   * @param videoBase642 Base 64 encoded video 2
   * @param offset Time offset in seconds to apply (video 2 will start playing offset seconds before video 1)
   * @returns Base 64 encoded stitched video
   */
  export async function stitchVideosSideBySide(videoBase641: string, videoBase642: string, offset: number): Promise<string> {
    // Create a temporary file for the stitched video
    const tempOutput = temp.path({ suffix: '.mp4' });

    // Create temporary files for the input videos
    const tempInput1 = temp.path({ suffix: '.mp4' });
    const tempInput2 = temp.path({ suffix: '.mp4' });
    fs.writeFileSync(tempInput1, Buffer.from(videoBase641, 'base64'));
    fs.writeFileSync(tempInput2, Buffer.from(videoBase642, 'base64'));

    // For debugging, write the input temp files to video_1.mp4 and video_2.mp4
    fs.writeFileSync('video_1.mp4', Buffer.from(videoBase641, 'base64'));
    fs.writeFileSync('video_2.mp4', Buffer.from(videoBase642, 'base64'));

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(tempInput1)
        // .inputOptions([`-itsoffset ${offset}`])
        .input(tempInput2)
        .outputOptions([
          // 1) scale both to same height/shape
          '-filter_complex',
          '[0:v]scale=-2:1080,setsar=1[v0];' +
          '[1:v]scale=-2:1080,setsar=1[v1];' +
          '[v0][v1]hstack=inputs=2[v]',
          // 2) use stacked video
          '-map', '[v]',
          // 3) keep audio from first video if it exists
          '-map', '0:a?',
          // 4) normal mp4 encoders
          '-c:v', 'libx264',
          '-c:a', 'aac',
          // '-pix_fmt', 'yuv420p'
          // (no -shortest, per your request)
        ])
        .format('mp4')
        .output(tempOutput)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .on('stderr', (line) => {
          console.log('ffmpeg:', line);
        })
        .run();
    });

    // Read the stitched video and encode to base64
    const stitchedVideoBuffer = fs.readFileSync(tempOutput);
    const stitchedVideoBase64 = stitchedVideoBuffer.toString('base64');

    // TEMP: Write the mp4 to stitched_video_base64.mp4 for debugging
    fs.writeFileSync('stitched_video_base64.mp4', stitchedVideoBuffer);

    // Clean up temp files
    temp.cleanupSync();

    return stitchedVideoBase64;
  }

  function bufferToStream(buffer: Buffer): Readable {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null); // end of stream
    return stream;
}