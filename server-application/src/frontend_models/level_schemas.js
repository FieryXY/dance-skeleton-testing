const LevelSchema = {
    type: "object",
    properties: {
        title: { type: "string" },
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
};
const FeedbackRequestSchema = {
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
};
const GeminiFeedbackResponseSchema = {
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
};
export { LevelSchema, FeedbackRequestSchema, GeminiFeedbackResponseSchema };
