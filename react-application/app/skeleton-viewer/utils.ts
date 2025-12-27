import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import type { LevelData, TimestampedPoses } from '~/api/endpoints';
import type { Keypoint } from '@tensorflow-models/pose-detection';
import { createRollEstimator } from './horizon-estimator';

// Angles
export const angles_to_consider: { [key: string]: {keypoints: string[], raw_weight: number} } = {
    "left_elbow": {
        "keypoints": ["left_shoulder", "left_elbow", "left_wrist"],
        "raw_weight": 3
    },
    "right_elbow": {
        "keypoints": ["right_shoulder", "right_elbow", "right_wrist"],
        "raw_weight": 3
    },
    "left_knee": {
        "keypoints": ["left_hip", "left_knee", "left_ankle"],
        "raw_weight": 3
    },
    "right_knee": {
        "keypoints": ["right_hip", "right_knee", "right_ankle"],
        "raw_weight": 3
    },
    "left_armpit": {
        "keypoints": ["left_hip", "left_shoulder", "left_elbow"],
        "raw_weight": 3
    },
    "right_armpit": {
        "keypoints": ["right_hip", "right_shoulder", "right_elbow"],
        "raw_weight": 3
    },
    "between_legs_left": {
        "keypoints": ["left_knee", "left_hip", "right_hip"],
        "raw_weight": 1.5
    },
    "between_legs_right": {
        "keypoints": ["right_knee", "right_hip", "left_hip"],
        "raw_weight": 1.5
    },
    "top_left_chest": {
        "keypoints": ["left_hip", "left_shoulder", "right_shoulder"],
        "raw_weight": 1
    },
    "top_right_chest": {
        "keypoints": ["right_hip", "right_shoulder", "left_shoulder"],
        "raw_weight": 1
    },
    "bottom_left_chest": {
        "keypoints": ["left_shoulder", "left_hip", "right_hip"],
        "raw_weight": 1
    },
    "bottom_right_chest": {
        "keypoints": ["right_shoulder", "right_hip", "left_hip"],
        "raw_weight": 1
    },
}

// Order to construct skeleton when trying to create a version of a reference skeleton
// but with the user's bone lengths
const skeleton_construction_order: string[][] = [
	["mid_hip", "left_hip"],
	["mid_hip", "right_hip"],
	["mid_hip", "mid_shoulder"],
	["mid_shoulder", "left_shoulder"],
	["mid_shoulder", "right_shoulder"],
	["left_shoulder", "left_elbow"],
	["right_shoulder", "right_elbow"],
	["left_elbow", "left_wrist"],
	["right_elbow", "right_wrist"],
	["left_hip", "left_knee"],
	["right_hip", "right_knee"],
	["left_knee", "left_ankle"],
	["right_knee", "right_ankle"],
];

const rollEstimator = createRollEstimator();




// Model and Detector Variables
const SCORE_THRESHOLD = 0.1
const PENALTY_FOR_OCCLUDED_KEYPOINT = -10
const model: poseDetection.SupportedModels = poseDetection.SupportedModels.BlazePose;
const modelType: string = poseDetection.movenet.modelType.SINGLEPOSE_THUNDER;
var detector: poseDetection.PoseDetector | null = null;

// Asynchronously load the detector
tf.ready().then(() => {
    // poseDetection.createDetector(model, {modelType}).then(result => {
    //     detector = result
    // });
    poseDetection.createDetector(model, {runtime: 'tfjs', modelType: 'full'}).then(result => {
        detector = result;
    });
});

export function createPoseFixerTransformer(getReferencePose: () => poseDetection.Pose | null, cachedAlignedReferencePose: poseDetection.Pose | null, setCachedAlignedReferencePose: (pose: poseDetection.Pose) => void): TransformStream {
	return new TransformStream({
		async transform(videoFrame: VideoFrame, controller) {
			// If the detector isn't ready for some reason, skip
			if(!detector) {
				controller.enqueue(videoFrame);
				return;
			}

			// Lazily initialize canvas and context on the first frame
			let offscreenCanvas = new OffscreenCanvas(videoFrame.displayWidth, videoFrame.displayHeight);
			const ctx = offscreenCanvas.getContext("2d");

			if (!ctx) {
				controller.enqueue(videoFrame);
				return;
			}

			ctx.save();

			// Initially mirror context
			ctx.translate(videoFrame.displayWidth, 0);
			ctx.scale(-1, 1);

			// Perform detection and drawing
			ctx.drawImage(videoFrame, 0, 0, videoFrame.displayWidth, videoFrame.displayHeight);


			ctx.restore();

			const poses: poseDetection.Pose[] = await detector.estimatePoses(offscreenCanvas as unknown as HTMLCanvasElement, { flipHorizontal: false });

			// Align reference pose with detected pose
			const referencePose = getReferencePose();

			// // Get horizon angle
			// const rollDeg = rollEstimator(videoFrame, {
			// 	roi: { yMin: 0.0, yMax: 0.75 },   // ignore bottom quarter (often desks/floors)
			// 	sampleStep: 2,
			// 	magThreshold: 40,
			// 	useManhattanPair: true,
			// });

			// // Draw horizon line for debugging
			// if(rollDeg !== null) {
			// 	const centerX = videoFrame.displayWidth / 2;
			// 	const centerY = videoFrame.displayHeight / 2;
			// 	const length = Math.sqrt(centerX * centerX + centerY * centerY);
			// 	const angleRad = rollDeg * (Math.PI / 180);

			// 	ctx.save();
			// 	ctx.strokeStyle = 'blue';
			// 	ctx.lineWidth = 2;
			// 	ctx.beginPath();
			// 	ctx.moveTo(centerX - length * Math.cos(angleRad), centerY - length * Math.sin(angleRad));
			// 	ctx.lineTo(centerX + length * Math.cos(angleRad), centerY + length * Math.sin(angleRad));
			// 	ctx.stroke();
			// 	ctx.restore();
			// }
			
			const alignedReferencePose = (referencePose && poses.length > 0) ? alignReferencePose(referencePose, poses[0]) : null;

			if(cachedAlignedReferencePose) {
				console.log("Using cached aligned reference pose for drawing");
				drawResults([cachedAlignedReferencePose], ctx, model, () => []);
			}	
			else if(alignedReferencePose) {
				drawResults([alignedReferencePose], ctx, model, () => []);
				setCachedAlignedReferencePose(alignedReferencePose);
			}

			drawResults(poses, ctx, model, () => [], "#cc8899");

			videoFrame.close();

			const newFrame = new VideoFrame(offscreenCanvas, {
				timestamp: videoFrame.timestamp,
				alpha: 'discard'
			});

			controller.enqueue(newFrame);

		}});
}

// Stream Transformer that adds skeleton onto the video stream and stores the poses with a function passed in by the caller
export function createSkeletonVideoTransformer(setPoses: (pose: TimestampedPoses) => any, getMirror: () => boolean, getBadKeypoints: () => string[]): TransformStream {
    return new TransformStream({
        async transform(videoFrame: VideoFrame, controller) {
            // If the detector isn't ready for some reason, skip
            if (!detector) {
                controller.enqueue(videoFrame);
                return;
            }
            
            // Lazily initialize canvas and context on the first frame
            let offscreenCanvas = new OffscreenCanvas(videoFrame.displayWidth, videoFrame.displayHeight);
            const ctx = offscreenCanvas.getContext("2d");
      
            if (!ctx) {
                controller.enqueue(videoFrame);
                return;
            }

            ctx.save();

            // Initially mirror context
            ctx.translate(videoFrame.displayWidth, 0);
            ctx.scale(-1, 1);
      
            // Perform detection and drawing
            ctx.drawImage(videoFrame, 0, 0, videoFrame.displayWidth, videoFrame.displayHeight);


            ctx.restore();

            const poses: poseDetection.Pose[] = await detector.estimatePoses(offscreenCanvas as unknown as HTMLCanvasElement, { flipHorizontal: false });
            setPoses({
                poses: poses,
                timestamp: videoFrame.timestamp/1000
            });
            if (poses.length > 0 && model != null) {
                drawResults(poses, ctx, model, getBadKeypoints);
            }

            if(getMirror()) {
                const mirroredOffscreenCanvas = new OffscreenCanvas(videoFrame.displayWidth, videoFrame.displayHeight);
                const mirroredCtx = mirroredOffscreenCanvas.getContext("2d");

                if(mirroredCtx) {
                    mirroredCtx.translate(videoFrame.displayWidth, 0);
                    mirroredCtx.scale(-1, 1);
                    mirroredCtx.drawImage(offscreenCanvas, 0, 0, videoFrame.displayWidth, videoFrame.displayHeight);
                    // Replace the original canvas with the mirrored one
                    offscreenCanvas = mirroredOffscreenCanvas;
                }
            }

            videoFrame.close();
      
            const newFrame = new VideoFrame(offscreenCanvas, {
                timestamp: videoFrame.timestamp,
                alpha: 'discard'
            });
            controller.enqueue(newFrame);
          }
    });
}

export function drawResults(poses: poseDetection.Pose[], ctx: OffscreenCanvasRenderingContext2D, model: poseDetection.SupportedModels, getBadKeypoints: () => string[], boneColor="#00ff00"): Boolean {
    for (const pose of poses) {
        drawKeypoints(pose.keypoints, ctx, getBadKeypoints);
        drawSkeleton(pose.keypoints, ctx, model, boneColor=boneColor);
    }
    return true;
}

function drawKeypoints(keypoints: poseDetection.Keypoint[], ctx: OffscreenCanvasRenderingContext2D, getBadKeypoints: () => string[]) {
    ctx.fillStyle = 'Red'; // Points color
    ctx.strokeStyle = 'White';
    ctx.lineWidth = 2;

    const badKeypoints = getBadKeypoints();

    for (const keypoint of keypoints) {
        if(!keypoint.score) {
            continue;
        }

        if (keypoint.score >= SCORE_THRESHOLD) { // Only draw confident points

            if (keypoint.name && badKeypoints.includes(keypoint.name)) {
                // Draw a blurry red circle for bad keypoints
                ctx.save();
                ctx.filter = 'blur(2px)';
                ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
                const badCircle = new Path2D();
                badCircle.arc(keypoint.x, keypoint.y, 20, 0, 2 * Math.PI);
                ctx.fill(badCircle);
                ctx.restore();
            }

            const circle = new Path2D();
            circle.arc(keypoint.x, keypoint.y, 4, 0, 2 * Math.PI);
            ctx.fill(circle);
            ctx.stroke(circle);

            // TEMP: Draw z value as white text next to the keypoint
            if (typeof keypoint.z !== "undefined") {
                ctx.save();
                ctx.font = "12px sans-serif";
                ctx.fillStyle = "white";
                ctx.strokeStyle = "black";
                ctx.lineWidth = 2;
                const text = keypoint.z.toFixed(2);
                // Draw black outline for readability
                ctx.strokeText(text, keypoint.x + 8, keypoint.y - 8);
                ctx.fillText(text, keypoint.x + 8, keypoint.y - 8);
                ctx.restore();
            }
        }
    }
}

function drawSkeleton(keypoints: poseDetection.Keypoint[], ctx: OffscreenCanvasRenderingContext2D, model: poseDetection.SupportedModels, boneColor = "#00ff00") {
    ctx.fillStyle = 'White';
    ctx.strokeStyle = boneColor; // Skeleton color
    ctx.lineWidth = 2;

    // Use the official adjacent pairs from the library for the selected model
    const adjacentPairs = poseDetection.util.getAdjacentPairs(model);

    for (const [i, j] of adjacentPairs) {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];

				if(!kp1 || !kp2) {
						continue;
				}

        if(!kp1.score || !kp2.score) {
            continue;
        }

        // If both keypoints are confident enough, draw the bone
        if (kp1.score >= SCORE_THRESHOLD && kp2.score >= SCORE_THRESHOLD) {
            ctx.beginPath();
            ctx.moveTo(kp1.x, kp1.y);
            ctx.lineTo(kp2.x, kp2.y);
            ctx.stroke();
        }
    }
}

   /**
     * Compares two poses and returns the root mean square distance between them after translation/scaling normalization
     * @param pose1 - The first pose to compare
     * @param pose2 - The second pose to compare
     * @returns The root mean square distance between the two poses
     */
function comparePoses2D(pose1: poseDetection.Pose, pose2: poseDetection.Pose) {
    // Apply Procrustes Analysis (but only normalize with translation and scaling, not rotation)

    let centroid1: number[] = [0, 0];
    let centroid2: number[] = [0, 0];

    // Calculate the centroid of each pose
    for (const keypoint of pose1.keypoints) {
        centroid1[0] += keypoint.x;
        centroid1[1] += keypoint.y;
    }
    centroid1[0] /= pose1.keypoints.length;
    centroid1[1] /= pose1.keypoints.length;

    for (const keypoint of pose2.keypoints) {
        centroid2[0] += keypoint.x;
        centroid2[1] += keypoint.y;
    }
    centroid2[0] /= pose2.keypoints.length;
    centroid2[1] /= pose2.keypoints.length;

    // Subtract the centroids from each keypoint to get the relative positions
    const relative1: Keypoint[] = pose1.keypoints.map(kp => ({
        x: kp.x - centroid1[0],
        y: kp.y - centroid1[1],
        name: kp.name,
    }));

    const relative2: Keypoint[] = pose2.keypoints.map(kp => ({
        x: kp.x - centroid2[0],
        y: kp.y - centroid2[1],
        name: kp.name,
    }));
    
    // Next, compute the root mean square distance of each pose
    const rmsd1 = Math.sqrt(relative1.reduce((sum, kp) => sum + kp.x * kp.x + kp.y * kp.y, 0) / relative1.length);
    const rmsd2 = Math.sqrt(relative2.reduce((sum, kp) => sum + kp.x * kp.x + kp.y * kp.y, 0) / relative2.length);

    // Scale the keypoints by these scales
    const final1 = relative1.map(kp => ({
        x: kp.x / rmsd1,
        y: kp.y / rmsd1,
        name: kp.name,
    }));

    const final2 = relative2.map(kp => ({
        x: kp.x / rmsd2,
        y: kp.y / rmsd2,
        name: kp.name,
    }));

    // Get the root square difference between the two poses
    let sum = 0;
    const filtered_names = ["left_wrist", "right_wrist", "left_elbow", "right_elbow", "left_knee", "right_knee", "left_ankle", "right_ankle"]
    for(const kp1 of final1) {
        for(const kp2 of final2) {
            if(kp1.name && kp1.name == kp2.name && filtered_names.includes(kp1.name)) {
                sum += (kp1.x - kp2.x) ** 2 + (kp1.y - kp2.y) ** 2;
            }
        }
    }
    return Math.sqrt(sum);
}

function comparePosesByAngles2D(pose1: poseDetection.Pose, pose2: poseDetection.Pose): { [key: string]: number } {
    // First, remove all keypoints that have a score less than the threshold
    const pose1Points: Keypoint[] = pose1.keypoints.filter(kp => kp.score && kp.score >= SCORE_THRESHOLD);
    const pose2Points: Keypoint[] = pose2.keypoints.filter(kp => kp.score && kp.score >= SCORE_THRESHOLD);

    let total_score = 0;

    // Store the scores for each angle. The name for each angle is the name of the second keypoint of the angle
    let all_angle_scores: Record<string, number> = {};

    // Calculate the angle between the three points for each angle in the list
    for(const angle_name in angles_to_consider) {
        const angle = angles_to_consider[angle_name].keypoints;
        const raw_weight = angles_to_consider[angle_name].raw_weight;
        const kp1_one = pose1Points.find(kp => kp.name == angle[0]);
        const kp1_two = pose1Points.find(kp => kp.name == angle[1]);
        const kp1_three = pose1Points.find(kp => kp.name == angle[2]);

        const kp2_one = pose2Points.find(kp => kp.name == angle[0]);
        const kp2_two = pose2Points.find(kp => kp.name == angle[1]);
        const kp2_three = pose2Points.find(kp => kp.name == angle[2]);

        if(!kp1_one || !kp1_two || !kp1_three || !kp2_one || !kp2_two || !kp2_three) {
            all_angle_scores[angle_name] = PENALTY_FOR_OCCLUDED_KEYPOINT;
            total_score += all_angle_scores[angle_name] * raw_weight;
            continue;
        }

        const angle_one = calculateAngleFromPoints(kp1_one.x, kp1_one.y, kp1_two.x, kp1_two.y, kp1_three.x, kp1_three.y);
        const angle_two = calculateAngleFromPoints(kp2_one.x, kp2_one.y, kp2_two.x, kp2_two.y, kp2_three.x, kp2_three.y);

        const angle_difference = Math.abs(angle_one - angle_two);
        const angle_score = 100 - (angle_difference * 100) / Math.PI;

        all_angle_scores[angle_name] = angle_score;
        total_score += angle_score * raw_weight;
    }
    // Normalize the total score by the sum of the raw weights
    const sum_of_raw_weights = Object.values(angles_to_consider).reduce((sum, angle) => sum + angle.raw_weight, 0);
    total_score /= sum_of_raw_weights;

    all_angle_scores["total"] = total_score;

    return all_angle_scores;
}

function comparePosesByAngles3D(pose1: poseDetection.Pose, pose2: poseDetection.Pose): { [key: string]: number } {
    // First, remove all keypoints that have a score less than the threshold
    if(!pose1.keypoints3D || !pose2.keypoints3D) {
        console.warn("One of the poses does not have 3D keypoints. Showing poses now:");
        console.log("Pose 1:", pose1);
        console.log("Pose 2:", pose2);
        return {"total": PENALTY_FOR_OCCLUDED_KEYPOINT};
    }

    const pose1Points: Keypoint[] = pose1.keypoints3D.filter(kp => kp.score && kp.score >= SCORE_THRESHOLD);
    const pose2Points: Keypoint[] = pose2.keypoints3D.filter(kp => kp.score && kp.score >= SCORE_THRESHOLD);

    let total_score = 0;

    // Store the scores for each angle. The name for each angle is the name of the second keypoint of the angle
    let all_angle_scores: Record<string, number> = {};

    // Calculate the angle between the three points for each angle in the list
    for(const angle_name in angles_to_consider) {
        const angle = angles_to_consider[angle_name].keypoints;
        const raw_weight = angles_to_consider[angle_name].raw_weight;
        const kp1_one = pose1Points.find(kp => kp.name == angle[0]);
        const kp1_two = pose1Points.find(kp => kp.name == angle[1]);
        const kp1_three = pose1Points.find(kp => kp.name == angle[2]);

        const kp2_one = pose2Points.find(kp => kp.name == angle[0]);
        const kp2_two = pose2Points.find(kp => kp.name == angle[1]);
        const kp2_three = pose2Points.find(kp => kp.name == angle[2]);

        if(!kp1_one || !kp1_two || !kp1_three || !kp2_one || !kp2_two || !kp2_three) {
            all_angle_scores[angle_name] = PENALTY_FOR_OCCLUDED_KEYPOINT;
            total_score += all_angle_scores[angle_name] * raw_weight;
            continue;
        }

        if(typeof kp1_one.z === "undefined" || typeof kp1_two.z === "undefined" || typeof kp1_three.z === "undefined" || typeof kp2_one.z === "undefined" || typeof kp2_two.z === "undefined" || typeof kp2_three.z === "undefined") {
            all_angle_scores[angle_name] = PENALTY_FOR_OCCLUDED_KEYPOINT;
            total_score += all_angle_scores[angle_name] * raw_weight;
            console.log("ERROR: Can't find z attribute on some of the 3D skeletons");
            continue;
        }

        const angle_one = calculateAngleFromPoints3D(kp1_one.x, kp1_one.y, kp1_one.z, kp1_two.x, kp1_two.y, kp1_two.z, kp1_three.x, kp1_three.y, kp1_three.z);
        const angle_two = calculateAngleFromPoints3D(kp2_one.x, kp2_one.y, kp2_one.z, kp2_two.x, kp2_two.y, kp2_two.z, kp2_three.x, kp2_three.y, kp2_three.z);

        const angle_difference = Math.abs(angle_one - angle_two);
        const angle_score = 100 - (angle_difference * 100) / Math.PI;

        all_angle_scores[angle_name] = angle_score;
        total_score += angle_score * raw_weight;
    }
    // Normalize the total score by the sum of the raw weights
    const sum_of_raw_weights = Object.values(angles_to_consider).reduce((sum, angle) => sum + angle.raw_weight, 0);
    total_score /= sum_of_raw_weights;

    all_angle_scores["total"] = total_score;

    return all_angle_scores;
}

function calculateAngleFromPoints(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    let angle = Math.atan2(y1 - y2, x1 - x2) - Math.atan2(y3 - y2, x3 - x2);

    // Add or subtract 2*pi's until the angle is between 0 and 2*pi
    while(angle < 0) {
        angle += 2 * Math.PI;
    }
    while(angle > 2 * Math.PI) {
        angle -= 2 * Math.PI;
    }

    if(angle > Math.PI) {
        angle = 2 * Math.PI - angle;
    }

    return angle;
}

function calculateAngleFromPoints3D(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number) {
    const v1 = [x1 - x2, y1 - y2, z1 - z2];
    const v2 = [x3 - x2, y3 - y2, z3 - z2];

    const dotProduct = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    const magnitudeV1 = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2);
    const magnitudeV2 = Math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2);

    let angle = Math.acos(dotProduct / (magnitudeV1 * magnitudeV2));

    // Normalize the angle to be between 0 and 180 degrees
    if (angle < 0) {
        angle += Math.PI;
    } else if (angle > Math.PI) {
        angle -= Math.PI;
    }

    return angle;
}

function alignReferencePose(referencePose: poseDetection.Pose, detectedPose: poseDetection.Pose): poseDetection.Pose {

	// Add a "mid_hip" keypoint to both poses for better alignment
	if(!referencePose.keypoints.find(kp => kp.name === "mid_hip")) {
		const referenceLeftHip = referencePose.keypoints.find(kp => kp.name === "left_hip");
		const referenceRightHip = referencePose.keypoints.find(kp => kp.name === "right_hip");
		if(!referenceLeftHip || !referenceRightHip) {
			console.warn("Cannot create mid_hip keypoint for reference pose because left_hip or right_hip is missing.");
			return referencePose;
		}
		referencePose.keypoints.push({
			x: (referenceLeftHip!.x + referenceRightHip!.x) / 2,
			y: (referenceLeftHip!.y + referenceRightHip!.y) / 2,
			z: (typeof referenceLeftHip!.z !== "undefined" && typeof referenceRightHip!.z !== "undefined") ? 
				(referenceLeftHip!.z! + referenceRightHip!.z!) / 2 : undefined,
			name: "mid_hip"
		});
	}

	if(!referencePose.keypoints.find(kp => kp.name === "mid_shoulder")) {
		const referenceLeftShoulder = referencePose.keypoints.find(kp => kp.name === "left_shoulder");
		const referenceRightShoulder = referencePose.keypoints.find(kp => kp.name === "right_shoulder");
		if(!referenceLeftShoulder || !referenceRightShoulder) {
			console.warn("Cannot create mid_shoulder keypoint for reference pose because left_shoulder or right_shoulder is missing.");
			return referencePose;
		}
		referencePose.keypoints.push({
			x: (referenceLeftShoulder!.x + referenceRightShoulder!.x) / 2,
			y: (referenceLeftShoulder!.y + referenceRightShoulder!.y) / 2,
			z: (typeof referenceLeftShoulder!.z !== "undefined" && typeof referenceRightShoulder!.z !== "undefined") ? 
				(referenceLeftShoulder!.z! + referenceRightShoulder!.z!) / 2 : undefined,
			name: "mid_shoulder"
		});
	}

	if(!detectedPose.keypoints.find(kp => kp.name === "mid_hip")) {
		const detectedLeftHip = detectedPose.keypoints.find(kp => kp.name === "left_hip");
		const detectedRightHip = detectedPose.keypoints.find(kp => kp.name === "right_hip");
		if(!detectedLeftHip || !detectedRightHip) {
			console.warn("Cannot create mid_hip keypoint for detected pose because left_hip or right_hip is missing.");
			return referencePose;
		}
		detectedPose.keypoints.push({
				x: (detectedLeftHip!.x + detectedRightHip!.x) / 2,
				y: (detectedLeftHip!.y + detectedRightHip!.y) / 2,
				z: (typeof detectedLeftHip!.z !== "undefined" && typeof detectedRightHip!.z !== "undefined") ? (detectedLeftHip!.z! + detectedRightHip!.z!) / 2 : undefined,
				name: "mid_hip"
		});
	}

	if(!detectedPose.keypoints.find(kp => kp.name === "mid_shoulder")) {
		const detectedLeftShoulder = detectedPose.keypoints.find(kp => kp.name === "left_shoulder");
		const detectedRightShoulder = detectedPose.keypoints.find(kp => kp.name === "right_shoulder");
		if(!detectedLeftShoulder || !detectedRightShoulder) {
			console.warn("Cannot create mid_shoulder keypoint for detected pose because left_shoulder or right_shoulder is missing.");
			return referencePose;
		}
		detectedPose.keypoints.push({
				x: (detectedLeftShoulder!.x + detectedRightShoulder!.x) / 2,
				y: (detectedLeftShoulder!.y + detectedRightShoulder!.y) / 2,
				z: (typeof detectedLeftShoulder!.z !== "undefined" && typeof detectedRightShoulder!.z !== "undefined") ? (detectedLeftShoulder!.z! + detectedRightShoulder!.z!) / 2 : undefined,
				name: "mid_shoulder"
		});
	}

	// First, compute bone lengths for the detected pose (taking into account depth if available)
	// We use the bones in skeleton_construction_order
	const boneLengths: (number | null)[] = [];
	for (const [startName, endName] of skeleton_construction_order) {
		const startKp = detectedPose.keypoints.find(kp => kp.name === startName);
		const endKp = detectedPose.keypoints.find(kp => kp.name === endName);

		if (startKp && endKp) {
			const length = Math.sqrt(
				(endKp.x - startKp.x) ** 2 +
				(endKp.y - startKp.y) ** 2
				// ((typeof endKp.z !== "undefined" && typeof startKp.z !== "undefined") ? (endKp.z - startKp.z) ** 2 : 0)
			);
			boneLengths.push(length);
		} else {
			boneLengths.push(null); // Placeholder for missing bone length
		}
	}

	let new_keypoints: Record<string, Keypoint> = {}
	new_keypoints["mid_hip"] = {
		x: 0,
		y: 0,
		z: 0,
		name: "mid_hip"
	};

	new_keypoints["mid_hip"] = referencePose.keypoints.find(kp => kp.name === "mid_hip")!;

	for(let i = 0; i < skeleton_construction_order.length; i++) {
		const [startName, endName] = skeleton_construction_order[i];
		const referenceStartKp = referencePose.keypoints.find(kp => kp.name === startName);
		const referenceEndKp = referencePose.keypoints.find(kp => kp.name === endName);
		const newStartKp = new_keypoints[startName];

		let boneLength = boneLengths[i];
		const directionUnitVector = {
			x: referenceEndKp!.x - referenceStartKp!.x,
			y: referenceEndKp!.y - referenceStartKp!.y,
			z: (typeof referenceEndKp!.z !== "undefined" && typeof referenceStartKp!.z !== "undefined") ? (referenceEndKp!.z - referenceStartKp!.z) : 0,
		};
		const magnitude = Math.sqrt(directionUnitVector.x ** 2 + directionUnitVector.y ** 2 + directionUnitVector.z ** 2);
		directionUnitVector.x /= magnitude;
		directionUnitVector.y /= magnitude;
		directionUnitVector.z /= magnitude;

		// if(newStartKp.z === undefined) {
		// 	console.log("WARNING: newStartKp.z is undefined for keypoint", startName);
		// 	return referencePose;
		// }

		const newEndKp = {
			x: newStartKp.x + directionUnitVector.x * (boneLength !== null ? boneLength : magnitude),
			y: newStartKp.y + directionUnitVector.y * (boneLength !== null ? boneLength : magnitude),
			z: (typeof newStartKp.z !== "undefined") ? (newStartKp.z + directionUnitVector.z * (boneLength !== null ? boneLength : magnitude)) : undefined,
			name: endName,
			score: 1.0,
		};

		new_keypoints[endName] = newEndKp;
	}

	// Re-order new_keypoints into an array with the same order as referencePose.keypoints
	const ordered_new_keypoints: Keypoint[] = [];
	for(const refKp of referencePose.keypoints) {
		const newKp = new_keypoints[refKp.name];
		if(newKp) {
			ordered_new_keypoints.push(newKp);
		} else {
			ordered_new_keypoints.push({
				x: refKp.x,
				y: refKp.y,
				name: refKp.name,
				score: 0.0,
			});
		}
	}

	// At this point, new_keypoints contains the reference pose with the user's bone lengths. Now, we use 2D Procrustes to align it to the detected pose.
	// Specifically, we use translation/scaling/rotation but only using left_hip and right_hip for alignment
	
	const keypointsForProcrustes: string[] = ["left_hip", "right_hip", "left_shoulder", "right_shoulder"];

	let detectedPoints: number[][] = [];
	let referencePoints: number[][] = [];

	for(const kpName of keypointsForProcrustes) {
		const detectedKp = detectedPose.keypoints.find(kp => kp.name === kpName);
		const referenceKp = new_keypoints[kpName];

		if(detectedKp && referenceKp && detectedKp.score && detectedKp.score >= SCORE_THRESHOLD) {
			detectedPoints.push([detectedKp.x, detectedKp.y, detectedKp.z ? detectedKp.z : 0]);
			referencePoints.push([referenceKp.x, referenceKp.y, referenceKp.z ? referenceKp.z : 0]);
		}
	}

	// If we don't have enough points for Procrustes, return the original reference pose
	if(detectedPoints.length < 2 || referencePoints.length < 2) {
		return referencePose;
	}

	// Compute centroids
	const detectedCentroid = detectedPoints.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]], [0, 0, 0]).map(coord => coord / detectedPoints.length);
	const referenceCentroid = referencePoints.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]], [0, 0, 0]).map(coord => coord / referencePoints.length);

	// Center the points
	const centeredDetected = detectedPoints.map(point => [point[0] - detectedCentroid[0], point[1] - detectedCentroid[1]]);
	const centeredReference = referencePoints.map(point => [point[0] - referenceCentroid[0], point[1] - referenceCentroid[1]]);

	// Compute scaling factors
	const detectedScale = Math.sqrt(centeredDetected.reduce((sum, point) => sum + point[0] ** 2 + point[1] ** 2, 0) / centeredDetected.length);
	const referenceScale = Math.sqrt(centeredReference.reduce((sum, point) => sum + point[0] ** 2 + point[1] ** 2, 0) / centeredReference.length);

	const scale = detectedScale / referenceScale;

	if (referenceScale < 1e-6) {
		console.log("WARNING: referenceScale is too small, skipping alignment.");
		return referencePose;
	}

	// Rotation
	let b = 0;
	let a = 0;
	for(let i = 0; i < centeredDetected.length; i++) {
		b += centeredReference[i][0] * centeredDetected[i][1] - centeredReference[i][1] * centeredDetected[i][0];
		a += centeredReference[i][0] * centeredDetected[i][0] + centeredReference[i][1] * centeredDetected[i][1];
	}

	const rotationAngle = Math.atan2(b, a);
	const cosTheta = Math.cos(rotationAngle);
	const sinTheta = Math.sin(rotationAngle);

	// Now apply all 3 transformations to all keypoints in new_keypoints
	let final_keypoints: Keypoint[] = [];
	for(const kpName in new_keypoints) {
		const kp = new_keypoints[kpName];
		// Center
		let pointVec = [kp.x - referenceCentroid[0], kp.y - referenceCentroid[1], kp.z ? kp.z - referenceCentroid[2] : 0];
		// Scale
		// pointVec[0] = pointVec[0] * scale;
		// pointVec[1] = pointVec[1] * scale;
		// Rotate
		// pointVec = [cosTheta * pointVec[0] - sinTheta * pointVec[1], sinTheta * pointVec[0] + cosTheta * pointVec[1]];
		// Translate
		pointVec = [pointVec[0] + detectedCentroid[0], pointVec[1] + detectedCentroid[1], pointVec[2] + detectedCentroid[2]];
		final_keypoints.push({
			x: pointVec[0],
			y: pointVec[1],
			z: 0,
			name: kpName,
			score: 1.0,
		});
	}

	// Re-order final_keypoints to match the order of referencePose.keypoints, adding score-0 keypoints if any are missing
	const ordered_final_keypoints: Keypoint[] = [];
	for(const refKp of referencePose.keypoints) {
		const finalKp = final_keypoints.find(kp => kp.name === refKp.name);
		if(finalKp) {
			ordered_final_keypoints.push(finalKp);
		} else {
			ordered_final_keypoints.push({
				x: refKp.x,
				y: refKp.y,
				z: 0,
				name: refKp.name,
				score: 0.0,
			});
		}
	}

	return {
		keypoints: ordered_final_keypoints,
	}
}

export function getPoseFromTimestamp(poses: TimestampedPoses[], originalTimestamp: number): TimestampedPoses | null {
	let left = 0;
	let right = poses.length - 1;
	let closestPose: TimestampedPoses = poses[0];
	
	while (left <= right) {
			const mid = Math.floor((left + right) / 2);
			const midPose = poses[mid];
			
			if (Math.abs(midPose.timestamp - originalTimestamp) < Math.abs(closestPose.timestamp - originalTimestamp)) {
					closestPose = midPose;
			}
			
			if (midPose.timestamp < originalTimestamp) {
					left = mid + 1;
			} else if (midPose.timestamp > originalTimestamp) {
					right = mid - 1;
			} else {
					// Exact match found
					closestPose = midPose;
					break;
			}
	}
	return closestPose;
}



// Scoring Class
export interface ScoredPose {
    originalTimestamp: number;
    webcamTimestamp: number;
    scores: Record<string, number>;
}

/**
 * Class that handles all the scoring logic for a dance session.
 * 
 * @param levelData - The level data to score
 * @param window_size - The size of the window to score
 * @param intervals - The intervals to score
 */
export class SessionScorer {
    private levelData: LevelData;
    private lastScoredTimestamp: number;
    private window_size: number;
    private timestamp_scores: ScoredPose[];
    private last_score: Record<string, number>;
    private intervals: [number, number][];

    constructor(levelData: LevelData, window_size: number = 5000, intervals: [number, number][] = []) {
        this.levelData = levelData;
        this.lastScoredTimestamp = 0;
        this.window_size = window_size;
        this.last_score = {"total": 0};
        this.intervals = intervals;
        this.timestamp_scores = [];
    }

    /**
     * Takes in the next user pose and update the scorer
     * @param poses - The next user pose to score
     * @returns The current window average score
     */
    consumePose(poses: TimestampedPoses, originalTimestamp: number): Record<string, number> {
        // Find the pose in the level data that is closest to the pose in terms of timestamp
        if(this.levelData.pose_data.length == 0) {
            return this.last_score;
        }

        // Binary search to find the closest pose since pose_data is sorted by timestamp
				const closestPose = getPoseFromTimestamp(this.levelData.pose_data, originalTimestamp);

        if(closestPose == null) {
            return this.last_score;
        }

        // // Don't score poses that happened before a pose that was already scored
        // if(closestPose.timestamp <= this.lastScoredTimestamp) {
        //     return this.current_window_average;
        // }

        if (poses.poses.length === 0 || closestPose.poses.length === 0) {
            return this.last_score;
        }

        // Score the pose
        const score = comparePosesByAngles3D(poses.poses[0], closestPose.poses[0]);
        // Current behavior is that for each pose in the original level, we keep the most recent score from the webcam
        this.timestamp_scores = this.timestamp_scores.filter(score_pair => score_pair.originalTimestamp != closestPose.timestamp)
        // Insert [closestPose.timestamp, score] into timestamp_scores in sorted order by timestamp
        let insertIdx = 0;
        let l = 0, r = this.timestamp_scores.length - 1;
        while (l <= r) {
            const mid = Math.floor((l + r) / 2);
            if (this.timestamp_scores[mid].originalTimestamp < closestPose.timestamp) {
                l = mid + 1;
            } else {
                r = mid - 1;
            }
        }
        insertIdx = l;
        this.timestamp_scores.splice(insertIdx, 0, {originalTimestamp: closestPose.timestamp, webcamTimestamp: poses.timestamp, scores: score});
        this.lastScoredTimestamp = closestPose.timestamp;
        this.last_score = score;

        return score;
    }

    /**
     * Computes the scores for each interval (usually 8 counts or something like that)
     * @returns An array of scores for each interval
     */
    computeIntervalScores() {
        let interval_scores: Record<string, number>[] = [];
        for(const interval of this.intervals) {
            const start = interval[0];
            const end = interval[1];
            const window_scores = this.timestamp_scores.filter(score => score.originalTimestamp >= start && score.originalTimestamp <= end);
            let window_average: Record<string, number> = {};
            if (window_scores.length > 0) {
                // window_scores is an array of score objects (dictionaries)
                // Collect all keys
                const allKeys = new Set<string>();
                window_scores.forEach(scoreObj => {
                    Object.keys(scoreObj.scores).forEach(key => allKeys.add(key));
                });
                // For each key, compute the average
                allKeys.forEach(key => {
                    let sum = 0;
                    let count = 0;
                    window_scores.forEach(scoreObj => {
                        if (scoreObj.scores.hasOwnProperty(key)) {
                            sum += scoreObj.scores[key];
                            count += 1;
                        }
                    });
                    window_average[key] = count > 0 ? sum / count : 0;
                });
            }
            interval_scores.push(window_average);
        }
        return interval_scores;
    }

    getTimestampScores() {
        return this.timestamp_scores;
    }

    findOptimalOffset(offset_tolerance: number): number {
        // Algorithm:
        // For each pose in the level data, find the pose in the timestamp_scores that is within the offset tolerance (in ms)
        // and has the highest score.
        // Once you have the optimal offset for each pose in the level data, return the average offset.
        let total_offset = 0;
        let count = 0;

        for (const levelPose of this.levelData.pose_data) {
            let bestOffset = null;
            let bestScore = -Infinity;

            for (const scoredPose of this.timestamp_scores) {
                const offset = levelPose.timestamp - scoredPose.webcamTimestamp;
                if (Math.abs(offset) <= offset_tolerance) {
                    const score = scoredPose.scores["total"] || 0;
                    if (score > bestScore) {
                        bestScore = score;
                        bestOffset = offset;
                    }
                }
            }

            if (bestOffset !== null) {
                total_offset += bestOffset;
                count += 1;
            }
        }

        if (count === 0) {
            return 0; // No valid offsets found
        }

        return total_offset / count;
    }
        
}
