const Constants = {
    // This is the minimum score required for a keypoint to show up on the annotated video
    SCORE_THRESHOLD: 0.3,
    // This is the regular prompt fed into Gemini to generate feedback for a video segment
    MAIN_FEEDBACK_PROMPT: `
These two videos are for the same choreography. The first one is the actual choreography and the second one is a user's attempt to do the choreography. Please indicate the top 3 things the user can work on to improve in the choreography. If one of the things is specific to a certain part of the dance, please indicate the timestamp range in the original choreography video corresponding to that thing in your answer.

Please provide the timestamps in milliseconds. For each recommendation, explain what the user needs to improve on and provide some advice on how to improve. Try your best to give concrete advice and tips instead of overarching statements.

Also, please provide a short summary of the user's performance in the choreography under the description field.

The entire response should refer to the user in the second person as if you are talking to the user directly.

I've also included some scores on a scale of 1 to 100 on how closely each joint angle in the user choreography corresponded to the original choreography below as a heuristic you can loosely refer to:
`,
    // This is used when mapping the timestamps that Gemini returns in the original choreography video to the timestamps in the user's video
    // If we can't find a mapping from original timestamp to user timestamp within this range of the timestamp that Gemini provides,
    // we won't provide timestamps for that recommendation
    MAX_TIMESTAMP_MAPPING_DIFF: 1000,

    // These are the score thresholds to determine which message to show the user based on their score
    GREAT_THRESHOLD: 90,
    GOOD_THRESHOLD: 70,
    OKAY_THRESHOLD: 50,
    BAD_THRESHOLD: 30,

}

export default Constants;