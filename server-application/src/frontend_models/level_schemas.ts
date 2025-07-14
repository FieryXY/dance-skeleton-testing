import ajv, { JSONSchemaType } from "ajv"

interface FrontendLevel {
    title: string,
    intervals: number[][]
}

interface FeedbackRequest {
    startTimestamp: number;
    endTimestamp: number;
    scoreData: Record<string, number>;
    timestampMappings: {
        originalTimestamp: number;
        mappedTimestamp: number;
    }[];
}

interface MiniFeedbackRequest {
    startTimestamp: number;
    endTimestamp: number;
    originalRecommendation: string;
}

interface GeminiMiniFeedbackResponse {
    description: string;
    sufficient: boolean;
}

interface GeminiFeedbackRecommendation {
    title: string;
    description: string;
    startTimestamp?: number;
    endTimestamp?: number;
}

interface ProcessedFeedbackRecommendation {
    title: string;
    description: string;
    startTimestamp?: number;
    endTimestamp?: number;
    mappedStartTimestamp?: number;
    mappedEndTimestamp?: number;
}

interface GeminiFeedbackResponse {
    description: string;
    recommendations: GeminiFeedbackRecommendation[];
}

interface FeedbackResponse {
    dialogHeader: string;
    description: string;
    recommendations: ProcessedFeedbackRecommendation[];
}

const LevelSchema: JSONSchemaType<FrontendLevel> = {
    type: "object",
    properties: {
        title: {type: "string"},
        intervals: {
            type: "array",
            items: {
                type: "array",
                items: { type: "integer" }
            }
        }
    },
    required: ["title", "intervals"],
    additionalProperties: false
}

const FeedbackRequestSchema: JSONSchemaType<FeedbackRequest> = {
    type: "object",
    properties: {
        startTimestamp: { type: "number" },
        endTimestamp: { type: "number" },
        scoreData: {
            type: "object",
            propertyNames: { type: "string" },
            required: []
        },
        timestampMappings: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    originalTimestamp: { type: "number" },
                    mappedTimestamp: { type: "number" },
                },
                required: ["originalTimestamp", "mappedTimestamp"],
                additionalProperties: false,
            }
        },
    },
    required: ["startTimestamp", "endTimestamp", "scoreData", "timestampMappings"],
    additionalProperties: false,
}

const MiniFeedbackRequestSchema: JSONSchemaType<MiniFeedbackRequest> = {
    type: "object",
    properties: {
        startTimestamp: { type: "number" },
        endTimestamp: { type: "number" },
        originalRecommendation: { type: "string" },
    },
    required: ["startTimestamp", "endTimestamp", "originalRecommendation"],
    additionalProperties: false,
}
const GeminiFeedbackResponseSchema: JSONSchemaType<GeminiFeedbackResponse> = {
    type: "object",
    properties: {
        description: { type: "string" },
        recommendations: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    startTimestamp: { type: "number", nullable: true },
                    endTimestamp: { type: "number", nullable: true },
                },
                required: ["title", "description"],
                additionalProperties: false,
            },
        }
    },
    required: ["description", "recommendations"],
    additionalProperties: false,
}

const GeminiMiniFeedbackResponseSchema: JSONSchemaType<GeminiMiniFeedbackResponse> = {
    type: "object",
    properties: {
        description: { type: "string" },
        sufficient: { type: "boolean" },
    },
    required: ["description", "sufficient"],
    additionalProperties: false,
}

export { LevelSchema, FeedbackRequestSchema, GeminiFeedbackResponseSchema, MiniFeedbackRequestSchema, GeminiMiniFeedbackResponseSchema }
export type { FeedbackResponse, FeedbackRequest, ProcessedFeedbackRecommendation, GeminiFeedbackRecommendation, GeminiFeedbackResponse, MiniFeedbackRequest, GeminiMiniFeedbackResponse }