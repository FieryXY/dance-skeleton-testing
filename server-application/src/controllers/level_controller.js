import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, loadImage } from 'canvas';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-node';
import { FeedbackRequestSchema, GeminiFeedbackResponseSchema, LevelSchema } from '../frontend_models/level_schemas.js';
import { manualValidateSchema, validateID } from '../frontend_models/validate_schema.js';
import Level from '../db_models/level_model.js';
import mongoose from 'mongoose';
import { GoogleGenAI, Type } from "@google/genai";
import temp from 'temp';
const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const SCORE_THRESHOLD = 0.3;
const MODEL = poseDetection.SupportedModels.MoveNet;
const MODEL_TYPE = poseDetection.movenet.modelType.SINGLEPOSE_THUNDER;
const MAIN_FEEDBACK_PROMPT = `
These two videos are for the same choreography. The first one is the actual choreography and the second one is a user's attempt to do the choreography. Please indicate the top 3 things the user can work on to improve in the choreography. If one of the things is specific to a certain part of the dance, please indicate the timestamp range in the original choreography video corresponding to that thing in your answer.

Also, please provide a short summary of the user's performance in the choreography under the description field.

I've also included some scores on a scale of 1 to 100 on how closely each joint angle in the user choreography corresponded to the original choreography below as a heuristic you can loosely refer to:
`;
const GREAT_THRESHOLD = 90;
const GOOD_THRESHOLD = 70;
const OKAY_THRESHOLD = 50;
const BAD_THRESHOLD = 30;
const MAX_TIMESTAMP_MAPPING_DIFF = 1000;
let detector = null;
(async () => {
    await tf.ready();
    detector = await poseDetection.createDetector(MODEL, { modelType: MODEL_TYPE });
})();
router.post('/create', upload.single('video'), async (req, res) => {
    if (!req.file) {
        res.status(400).send('No video file uploaded for level');
        return;
    }
    const inputPath = req.file.path;
    try {
        // Parse data JSON
        const dataJSON = JSON.parse(req.body.data);
        if (!manualValidateSchema(LevelSchema, dataJSON)) {
            res.status(400).send("Invalid JSON data uploaded for level");
            return;
        }
        // Create a unique temp directory for this request
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poseproc-'));
        const framesDir = path.join(tempDir, 'frames');
        fs.mkdirSync(framesDir);
        const outputVideoPath = path.join(tempDir, 'annotated_output.mp4');
        const outputJSONPath = path.join(tempDir, 'poses.json');
        // Extract frames using ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .output(`${framesDir}/frame_%06d.png`)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
        const video_info = await getVideoInfo(inputPath);
        const fps = video_info.fps;
        const poses = [];
        for (let i = 0; i < frameFiles.length; i++) {
            const framePath = path.join(framesDir, frameFiles[i]);
            const image = await loadImage(framePath);
            const canvas = createCanvas(image.width, image.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const estPoses = await detector.estimatePoses(canvas, { flipHorizontal: false });
            poses.push({
                timestamp: (i * 1000) / fps,
                poses: estPoses
            });
            drawResults(estPoses, ctx, MODEL);
            fs.writeFileSync(framePath, canvas.toBuffer('image/png'));
        }
        fs.writeFileSync(outputJSONPath, JSON.stringify(poses, null, 2));
        // Combine frames back into video (with the audio)
        await new Promise((resolve, reject) => {
            ffmpeg(`${framesDir}/frame_%06d.png`)
                .inputOptions([`-framerate ${fps}`])
                .input(inputPath) // for audio
                .outputOptions('-map', '0:v', // video from frames
            '-map', '1:a?', // audio from original video, if available
            '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest')
                .output(outputVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        let newLevel = new Level({
            title: dataJSON.title,
            intervals: dataJSON.intervals,
            pose_data: poses,
        });
        newLevel.save().then(doc => {
            if (!mongoose.connection.db) {
                Level.findByIdAndDelete(doc._id);
                res.status(500).send("Error connecting with database to store video files");
                return;
            }
            let bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
            if (!req.file) {
                // This should never run!
                return;
            }
            // Save the original video
            const originalStream = fs.createReadStream(inputPath);
            originalStream.pipe(bucket.openUploadStream("ORIGINAL_" + doc._id.toString()));
            // Save the video annotated with the skeleton
            const skeletonStream = fs.createReadStream(outputVideoPath);
            skeletonStream.pipe(bucket.openUploadStream("ANNOTATED_" + doc._id.toString()));
            // Send the Object ID of the new Level object
            res.send(doc._id.toString());
        });
    }
    catch (err) {
        console.error('Error during processing:', err);
        res.status(500).send('Failed to process video');
    }
});
router.get('/:id', validateID(), async (req, res) => {
    try {
        const level = await Level.findById(req.params.id);
        if (!level) {
            res.status(404).send('Level not found');
            return;
        }
        res.json(level);
    }
    catch (err) {
        res.status(500).send('Server error');
    }
});
router.get('/getVideo/:id', async (req, res) => {
    try {
        if (!mongoose.connection.db) {
            res.status(500).send("Error connecting with database");
            return;
        }
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
        const downloadStream = bucket.openDownloadStreamByName("ORIGINAL_" + req.params.id);
        downloadStream.pipe(res);
    }
    catch (err) {
        res.status(500).send('Error retrieving original video');
    }
});
router.get('/getAnnotatedVideo/:id', async (req, res) => {
    try {
        if (!mongoose.connection.db) {
            res.status(500).send("Error connecting with database");
            return;
        }
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
        const downloadStream = bucket.openDownloadStreamByName("ANNOTATED_" + req.params.id);
        downloadStream.pipe(res);
    }
    catch (err) {
        res.status(500).send('Error retrieving annotated video');
    }
});
router.post('/getFeedback/:id', upload.single('video'), async (req, res) => {
    if (!req.file) {
        res.status(400).send('No video file uploaded for level');
        return;
    }
    const inputPath = req.file.path;
    try {
        const level = await Level.findById(req.params.id);
        if (!level) {
            res.status(404).send('Level not found');
            return;
        }
        const dataJSON = JSON.parse(req.body.data);
        if (!manualValidateSchema(FeedbackRequestSchema, dataJSON)) {
            res.status(400).send("Invalid JSON data uploaded for feedback request");
            return;
        }
        // Convert the uploaded video to mp4
        const tempUploadedPath = temp.path({ suffix: '.mp4' });
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .output(tempUploadedPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        // Get the base64 encoding for the uploaded video
        const videoBase64 = fs.readFileSync(tempUploadedPath, { encoding: 'base64' });
        const startTimestamp = dataJSON.startTimestamp;
        const endTimestamp = dataJSON.endTimestamp;
        const scoreData = dataJSON.scoreData;
        if (!mongoose.connection.db) {
            res.status(500).send("Error connecting with database");
            return;
        }
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
        // Extract only the portion of the video from beginningTimestamp to endTimestamp (in ms)
        const originalVideoBuffer = await new Promise((resolve, reject) => {
            const stream = bucket.openDownloadStreamByName("ORIGINAL_" + req.params.id);
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
        // Write buffer to a temp file
        const tempInput = temp.path({ suffix: '.mp4' });
        const tempOutput = temp.path({ suffix: '.mp4' });
        fs.writeFileSync(tempInput, originalVideoBuffer);
        // Convert ms to seconds for ffmpeg
        const startSec = startTimestamp / 1000;
        const durationSec = (endTimestamp - startTimestamp) / 1000;
        await new Promise((resolve, reject) => {
            ffmpeg(tempInput)
                .setStartTime(startSec)
                .setDuration(durationSec)
                .output(tempOutput)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        // Read the trimmed video and encode to base64
        const trimmedVideoBuffer = fs.readFileSync(tempOutput);
        const originalVideoBase64 = trimmedVideoBuffer.toString('base64');
        // Clean up temp files
        temp.cleanupSync();
        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
        });
        const contents = [
            {
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: "video/mp4",
                            data: originalVideoBase64
                        }
                    },
                    {
                        inlineData: {
                            mimeType: "video/mp4",
                            data: videoBase64
                        }
                    },
                    {
                        text: MAIN_FEEDBACK_PROMPT + "\n\n" + JSON.stringify(scoreData)
                    }
                ]
            }
        ];
        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        description: {
                            type: Type.STRING,
                        },
                        recommendations: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    title: {
                                        type: Type.STRING,
                                    },
                                    description: {
                                        type: Type.STRING,
                                    },
                                    startTimestamp: {
                                        type: Type.NUMBER,
                                    },
                                    endTimestamp: {
                                        type: Type.NUMBER,
                                    },
                                },
                                required: ["title", "description"],
                                propertyOrdering: ["title", "description", "startTimestamp", "endTimestamp"],
                                additionalProperties: false,
                            }
                        }
                    },
                    required: ["description", "recommendations"],
                    additionalProperties: false,
                }
            }
        });
        if (!response.text) {
            res.status(500).send("Error generating feedback");
            return;
        }
        const geminiResponseJSON = JSON.parse(response.text);
        if (!manualValidateSchema(GeminiFeedbackResponseSchema, geminiResponseJSON)) {
            res.status(500).send("Error generating feedback");
            return;
        }
        const processedRecommendations = geminiResponseJSON.recommendations.map((recommendation) => {
            if (!recommendation.startTimestamp || !recommendation.endTimestamp) {
                return recommendation;
            }
            const mappedStartTimestamp = getTimestampMapping(recommendation.startTimestamp, dataJSON);
            const mappedEndTimestamp = getTimestampMapping(recommendation.endTimestamp, dataJSON);
            if (!mappedStartTimestamp || !mappedEndTimestamp) {
                // Return recommendation without startTimestamp and endTimestamp
                const { startTimestamp, endTimestamp, ...baseRecommendation } = recommendation;
                return baseRecommendation;
            }
            return {
                ...recommendation,
                mappedStartTimestamp,
                mappedEndTimestamp,
            };
        });
        const responseJSON = {
            dialogHeader: "Unknown",
            description: geminiResponseJSON.description,
            recommendations: processedRecommendations,
        };
        if ("total" in scoreData) {
            const totalScore = scoreData.total;
            if (totalScore >= GREAT_THRESHOLD) {
                responseJSON.dialogHeader = "Great!";
            }
            else if (totalScore >= GOOD_THRESHOLD) {
                responseJSON.dialogHeader = "Good!";
            }
            else if (totalScore >= OKAY_THRESHOLD) {
                responseJSON.dialogHeader = "Okay";
            }
            else {
                responseJSON.dialogHeader = "Needs Improvement";
            }
        }
        res.json(responseJSON);
    }
    catch (err) {
        res.status(500).send('Failed to process video');
    }
});
function drawResults(poses, ctx, model) {
    for (const pose of poses) {
        drawKeypoints(pose.keypoints, ctx);
        drawSkeleton(pose.keypoints, ctx, model);
    }
}
function drawKeypoints(keypoints, ctx) {
    ctx.fillStyle = 'Red';
    ctx.strokeStyle = 'White';
    ctx.lineWidth = 2;
    for (const keypoint of keypoints) {
        if (keypoint.score && keypoint.score >= SCORE_THRESHOLD) {
            ctx.beginPath();
            ctx.arc(keypoint.x, keypoint.y, 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }
    }
}
function drawSkeleton(keypoints, ctx, model) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    const adjacentPairs = poseDetection.util.getAdjacentPairs(model);
    for (const [i, j] of adjacentPairs) {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];
        if (!kp1.score || !kp2.score) {
            continue;
        }
        if (kp1.score >= SCORE_THRESHOLD && kp2.score >= SCORE_THRESHOLD) {
            ctx.beginPath();
            ctx.moveTo(kp1.x, kp1.y);
            ctx.lineTo(kp2.x, kp2.y);
            ctx.stroke();
        }
    }
}
function getVideoInfo(inputPath) {
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
function getTimestampMapping(originalTimestamp, feedbackRequest) {
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
    if (minDiff > MAX_TIMESTAMP_MAPPING_DIFF) {
        return null;
    }
    return mappings[closestIdx].mappedTimestamp;
}
export { router as LevelController };
