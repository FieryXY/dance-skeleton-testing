import { useCallback, useEffect, useRef, useState } from "react"
import type { Route } from "react-router";
import * as poseDetection from '@tensorflow-models/pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import { createSkeletonVideoTransformer, drawResults } from "./utils"
import type { TimestampedPoses } from "~/api/endpoints";



interface SkeletonViewerProps {
  reportPoses: (pose: TimestampedPoses) => void,
  useWebcam: boolean,
  mediaStream: MediaStream | null,
  width?: number,
  height?: number,
  badKeypointsProp: string[]
}

export default function SkeletonViewer({
  reportPoses,
  useWebcam,
  mediaStream,
  width = 800,
  height = 800,
  badKeypointsProp = [],
}: SkeletonViewerProps) {
	  // useRef to get a reference to the video element
  const videoRef = useRef<HTMLVideoElement>(null);
  // useState to store and display any error messages
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mirrorRef = useRef<boolean>(false);
  const badKeypointsRef = useRef<string[]>([]);

  const getMirror = useCallback(() => mirrorRef.current, []);
  const getBadKeypoints = useCallback(() => badKeypointsRef.current, []);

  useEffect(() => {
    badKeypointsRef.current = badKeypointsProp;
  }, [badKeypointsProp])

  // This handles streaming webcam to video element and skeleton processing
  useEffect(() => {
    // 2. Define an async function inside the effect to run our setup logic
    const setupAndRun = async () => {
      console.log("Async function running")
      try {

        let stream: MediaStream | null = null;

        // Get the webcam stream
        if(useWebcam) {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
              setError("Your browser does not support accessing the webcam.");
              console.log("Your browser does not support accessing the webcam.")
              return;
          }
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        // Use the external video stream that should be provided
        else {
          if(!mediaStream) {
            console.log("No Media Stream Provided")
            return;
          }
          stream = mediaStream;
        }

        // Create the processing pipeline
        const videoTrack = stream.getVideoTracks()[0];
        const trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
        const trackGenerator = new MediaStreamTrackGenerator({ kind: "video" });
        const transformer: TransformStream = createSkeletonVideoTransformer(reportPoses, getMirror, getBadKeypoints);

        trackProcessor.readable.pipeThrough(transformer).pipeTo(trackGenerator.writable);
        
        const processedStream = new MediaStream([trackGenerator]);
        if (videoRef.current) {
            videoRef.current.srcObject = processedStream;
            videoRef.current.play();
        }

      } catch (err) {
        console.error("Error during setup or processing: ", err);
        setError("Could not access webcam or initialize model. Please grant permission.");
      }
    };

    // Call the async function
    if(videoRef.current && videoRef.current.srcObject) {
      // Don't allow changing the media stream once it has already been set once
      console.log("Media Stream already present")
      return;
    }
    setupAndRun();

    // 5. Cleanup function for both the detector and the stream
    return () => {
      // The detector state is captured in the closure
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        console.log("Webcam stream stopped.");
      }
    };
  }, [mediaStream]);


	return (
		<div id="container">
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video autoPlay={true} id="videoElement" 
        style={{
          backgroundColor: "gray"
        }}
        muted
        playsInline
        ref={videoRef}
        width={width}
        height={height}
      />
         { /* Mirror Toggle */ }
        <button
          onClick={() => mirrorRef.current = !mirrorRef.current}
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            padding: "6px 12px",
            borderRadius: "4px",
            border: "none",
            backgroundColor: "#6c757d",
            color: "#fff",
          }}
        >
          Toggle Mirror
      </button>
      </div>
      <canvas
          width={width}
          height={height}
          style={{ display: 'block' }}
          ref={canvasRef}
        />
		</div>
	);
}
