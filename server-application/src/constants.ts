const Constants = {
    // This is the minimum score required for a keypoint to show up on the annotated video
    SCORE_THRESHOLD: 0.3,
    // This is the regular prompt fed into Gemini to generate feedback for a video segment
    MAIN_FEEDBACK_PROMPT: `
    Act as an expert dance instructor providing feedback on a student's performance.

    You are given the following videos in order. The first one is the reference choreography and the second one is a user's attempt to do the choreography. Use this data as a reference to provide feedback on the user's performance.

    Note that both videos are significantly slowed down compared to real-time to allow for detailed analysis.

    Your task is to provide a concise overall summary and the top 3 most important, actionable recommendations for improvement.
    
    Please indicate the top 3 things the user can work on to improve in the choreography. If one of the things is specific to a certain part of the dance, please indicate the timestamp range in the original choreography video corresponding to that thing in your answer.

    **Output Rules:**

1.  Overall Summary: In the main "description" field, provide a brief, encouraging summary of the user's performance, mentioning one thing they did well.
2.  Actionable Recommendations:
    * Identify the top 3 specific areas for improvement tied to a specific action performed in the reference choreography.
    * For each recommendation, provide a "cause and effect" explanation. For example, "Because your supporting leg isn't straight, your turn is losing balance." 
    * Use analogies to help the user understand the intended dance move relating to the necessary area of improvement(e.g., "your right arm should be loose like grass waving in the wind").
    * Provide concrete, specific actions the user can take to improve. Avoid vague advice.
    * Primarily utilize the original choreography video as a reference for your recommendations.
3.  Precise Timestamps:
    * IMPORTANT CONTEXT: The video clip you are seeing does not start at 00:00:000. It is a segment taken from a longer video, and it begins at the timestamp {{START_TIMESTAMP_MS}} milliseconds. All timestamps you provide must be relative to the start of THIS CLIP. For example, if a mistake happens 2 seconds into the clip, you must return a startTimestamp of 2000.
    * For each recommendation, identify the exact start and end timestamps in the original choreography video where the core of the mistake occurs. Limit the range to a maximum of 5000 milliseconds.
    * Briefly describe the specific move that happens during this timestamp (e.g., "during the pirouette," "on the arm wave").
4.  Sufficiently Long Timestamp Ranges:
    * Ensure that the timestamp ranges you provide for each recommendation are at least 5,000 milliseconds long to give the user enough context to understand and work on the improvement. If a mistake is very brief, expand the range slightly to meet this minimum duration while still focusing on the key moment of the action. Note that the minimum length is relatively large to account for the videos being slowed down!
    * Please note that the timestamps you are outputting should always be in milliseconds. Never use any other unit!
5.  Tone: The entire response must be in the second person ("you," "your") in an encouraging, and constructive tone as if to talk to the student directly.
6.  Negative Constraints: Do not use vague language such as "fluidity", "energy", or "power". All feedback must be tied to a visual observation.

Here are some data points regarding the accuracy of the user's performance. Use these as a loose heuristic and primarily rely on the videos to provide feedback:
`,

    INTERVAL_NOTES_PROMPT_ADDITION: `
    Also, the choreographer provided some notes of their own that may or may not be relevant to this segment of the choreography. You don't have to use then, but if they are relevant,
    here they are:
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

    // This is the prompt used to generate mini feedback
    MINI_FEEDBACK_PROMPT: `
        You are a private dance instructor. Earlier, you gave the user some feedback on a particular part of a dance. You now
        want to give some more feedback on the same part after they have re-attempted it. You are given the following videos in order:
        1. The user's previous attempt at the dance
        2. The user's new attempt at the dance
        3. The original dance

        Please provide some feedback on the user's new attempt based on the previous attempt, the original dance, and the original feedback you gave the user.

        Also, determine if the user has sufficiently improved based on your original feedback. Your response should be
        in the second person as if you are talking to the user directly.

        Below is the original feedback you gave the user:
    `

}

export default Constants;