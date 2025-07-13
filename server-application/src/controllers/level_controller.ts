import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, loadImage } from 'canvas';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-node';
import { FeedbackRequest, FeedbackRequestSchema, FeedbackResponse, GeminiFeedbackRecommendation, GeminiFeedbackResponse, GeminiFeedbackResponseSchema, LevelSchema, ProcessedFeedbackRecommendation } from '../frontend_models/level_schemas.js';
import { manualValidateSchema, validateID } from '../frontend_models/validate_schema.js';
import Level from '../db_models/level_model.js';
import mongoose from 'mongoose';
import { Content, GoogleGenAI, Type } from "@google/genai";
import temp from 'temp';
import Constants from '../constants.js';
import { drawResults, getTimestampMapping, getVideoInfo } from './level_utils.js';


const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const MODEL = poseDetection.SupportedModels.MoveNet;
const MODEL_TYPE = poseDetection.movenet.modelType.SINGLEPOSE_THUNDER;

let detector: poseDetection.PoseDetector | null = null;

(async () => {
  await tf.ready();
  detector = await poseDetection.createDetector(MODEL, { modelType: MODEL_TYPE });
})();

interface TimestampedPose {
  timestamp: number;
  poses: poseDetection.Pose[];
}

router.post('/create', upload.single('video'), async (req, res) => {
  if (!req.file) {
    res.status(400).send('No video file uploaded for level');
    return;
  }

  const inputPath = req.file.path;

  try {
    // Parse data JSON
    const dataJSON = JSON.parse(req.body.data);
    if(!manualValidateSchema(LevelSchema, dataJSON)) {
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
    const poses: TimestampedPose[] = [];

    for (let i = 0; i < frameFiles.length; i++) {
      const framePath = path.join(framesDir, frameFiles[i]);
      const image = await loadImage(framePath);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');

      ctx.drawImage(image, 0, 0);
      const estPoses = await detector!.estimatePoses(canvas as any, { flipHorizontal: false });
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
        .outputOptions(
          '-map', '0:v',          // video from frames
          '-map', '1:a?',         // audio from original video, if available
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-pix_fmt', 'yuv420p',
          '-shortest'
        )
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
      if(!mongoose.connection.db) {
        Level.findByIdAndDelete(doc._id);
        res.status(500).send("Error connecting with database to store video files");
        return;
      }
      let bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
      if(!req.file) {
        // This should never run!
        return;
      }

      // Save the original video
      const originalStream = fs.createReadStream(inputPath);
      originalStream.pipe(bucket.openUploadStream("ORIGINAL_"+doc._id.toString()));

      // Save the video annotated with the skeleton
      const skeletonStream = fs.createReadStream(outputVideoPath);
      skeletonStream.pipe(bucket.openUploadStream("ANNOTATED_"+doc._id.toString()));

      // Send the Object ID of the new Level object
      res.send(doc._id.toString());
    });
  } catch (err) {
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
  } catch (err) {
    res.status(500).send('Server error');
  }
});

router.get('/getVideo/:id', async (req, res) => {
  try {
    if(!mongoose.connection.db) {
      res.status(500).send("Error connecting with database");
      return;
    }
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
    const downloadStream = bucket.openDownloadStreamByName("ORIGINAL_" + req.params.id);
    downloadStream.pipe(res);
  } catch (err) {
    res.status(500).send('Error retrieving original video');
  }
});

router.get('/getAnnotatedVideo/:id', async (req, res) => {
  try {
    if(!mongoose.connection.db) {
      res.status(500).send("Error connecting with database");
      return;
    }
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
    const downloadStream = bucket.openDownloadStreamByName("ANNOTATED_" + req.params.id);
    downloadStream.pipe(res);
  } catch (err) {
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
    if(!level) {
      res.status(404).send('Level not found');
      return;
    }

    const dataJSON = JSON.parse(req.body.data);
    if(!manualValidateSchema(FeedbackRequestSchema, dataJSON)) {
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
    const scoreData: Record<string, number> = dataJSON.scoreData;

    if(!mongoose.connection.db) {
      res.status(500).send("Error connecting with database");
      return;
    }

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);

    // Extract only the portion of the video from beginningTimestamp to endTimestamp (in ms)
    const originalVideoBuffer: Buffer = await new Promise((resolve, reject) => {
      const stream = bucket.openDownloadStreamByName("ORIGINAL_" + req.params.id);
      const chunks: Buffer[] = [];
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

    const contents: Content[] = [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "video/mp4",
              data: originalVideoBase64 as string
            }
          },
          {
            inlineData: {
              mimeType: "video/mp4",
              data: videoBase64 as string
            }
          },
          {
            text: Constants.MAIN_FEEDBACK_PROMPT + "\n\n" + JSON.stringify(scoreData)
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

    if(!response.text) {
      res.status(500).send("Error generating feedback");
      return;
    }

    const geminiResponseJSON = JSON.parse(response.text) as GeminiFeedbackResponse;

    if(!manualValidateSchema(GeminiFeedbackResponseSchema, geminiResponseJSON)) {
      res.status(500).send("Error generating feedback");
      return;
    }

    const processedRecommendations: ProcessedFeedbackRecommendation[] = geminiResponseJSON.recommendations.map((recommendation: GeminiFeedbackRecommendation) => {
      
      if(!recommendation.startTimestamp || !recommendation.endTimestamp) {
        return recommendation;
      }

      const mappedStartTimestamp = getTimestampMapping(recommendation.startTimestamp, dataJSON);
      const mappedEndTimestamp = getTimestampMapping(recommendation.endTimestamp, dataJSON);

      if(!mappedStartTimestamp || !mappedEndTimestamp) {
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

    const responseJSON: FeedbackResponse = {
      dialogHeader: "Unknown",
      description: geminiResponseJSON.description,
      recommendations: processedRecommendations,
    };

    if("total" in scoreData) {
      const totalScore = scoreData.total;
      if(totalScore >= Constants.GREAT_THRESHOLD) {
        responseJSON.dialogHeader = "Great!";
      } else if(totalScore >= Constants.GOOD_THRESHOLD) {
        responseJSON.dialogHeader = "Good!";
      } else if(totalScore >= Constants.OKAY_THRESHOLD) {
        responseJSON.dialogHeader = "Okay";
      } else {
        responseJSON.dialogHeader = "Needs Improvement";
      }
    }

    res.json(responseJSON);

  } catch (err) {
    res.status(500).send('Failed to process video');
  }
});



export { router as LevelController };
