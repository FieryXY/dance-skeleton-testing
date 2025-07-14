import express from 'express';
import multer from 'multer';
import temp from 'temp';
import { trimVideo } from './level_utils.js';
import { VideoTrimRequestSchema } from '../frontend_models/video_schemas.js';
import { manualValidateSchema } from '../frontend_models/validate_schema.js';
import * as fs from 'fs';


const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/trim', upload.single('video'), async (req, res) => {
    if(!req.file) {
        res.status(400).send('No video file uploaded for level');
        return;
    }

    const dataJSON = JSON.parse(req.body.data);
    if(!manualValidateSchema(VideoTrimRequestSchema, dataJSON)) {
        res.status(400).send("Invalid JSON data uploaded for video trim request");
        return;
    }

    const inputPath = req.file.path;
    const outputPath = temp.path({ suffix: '.mp4' });

    await trimVideo(inputPath, outputPath, dataJSON.startTimestamp, dataJSON.endTimestamp);

    const trimmedVideoBase64 = fs.readFileSync(outputPath, { encoding: 'base64' });

    res.json({ trimmedVideoBase64 });
});

export { router as VideoController };