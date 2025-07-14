const VideoTrimRequestSchema = {
    type: "object",
    properties: {
        startTimestamp: { type: "number" },
        endTimestamp: { type: "number" },
    },
    required: ["startTimestamp", "endTimestamp"],
    additionalProperties: false,
};
export { VideoTrimRequestSchema };
