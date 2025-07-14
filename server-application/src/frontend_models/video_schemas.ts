import { JSONSchemaType } from "ajv";

interface VideoTrimRequest {
    startTimestamp: number;
    endTimestamp: number;
}

interface VideoTrimResponse {
    trimmedVideoBase64: string;
}

const VideoTrimRequestSchema: JSONSchemaType<VideoTrimRequest> = {
    type: "object",
    properties: {
        startTimestamp: { type: "number" },
        endTimestamp: { type: "number" },
    },
    required: ["startTimestamp", "endTimestamp"],
    additionalProperties: false,
}

export { VideoTrimRequestSchema }

export { VideoTrimRequest, VideoTrimResponse };