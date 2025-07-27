const Constants = {
    // This is the minimum score required for a keypoint to show up on the annotated video
    SCORE_THRESHOLD: 0.3,
    // This is the regular prompt fed into Gemini to generate feedback for a video segment
    MAIN_FEEDBACK_PROMPT: `
    Act as an expert dance instructor providing feedback on a student's performance.

    You are given the following videos in order. The first one is the reference choreography and the second one is a user's attempt to do the choreography. Use this data as a reference to provide feedback on the user's performance.

    Your task is to provide a concise overall summary and the top 3 most important, actionable recommendations for improvement.
    
    Please indicate the top 3 things the user can work on to improve in the choreography. If one of the things is specific to a certain part of the dance, please indicate the timestamp range in the original choreography video corresponding to that thing in your answer.

    **Output Rules:**

1.  Overall Summary: In the main "description" field, provide a brief, encouraging summary of the user's performance, mentioning one thing they did well.
2.  Actionable Recommendations:
    * Identify the top 3 areas for improvement.
    * For each recommendation, provide a "cause and effect" explanation. For example, "Because your supporting leg isn't straight, your turn is losing balance."
    * Identify and briefly describe specific individual moves or parts of the dance that need improvement (e.g., "during the spin," "on the arm wave").
    * Identify the specific joint angles that need to be adjusted and possible analogies that may be relevant to the solution (e.g., "your right arm should be at a 180-degree angle like a tree branch before the pirouette").
    * Provide a concrete, drill-like suggestion for how to practice and fix the issue.
3.  Precise Timestamps:
    * For each recommendation, identify the exact start and end timestamps in milliseconds in the original choreography video where the core of the mistake occurs.
    * Briefly describe the specific move that happens during this timestamp (e.g., "during the pirouette," "on the arm wave").
4.  Tone: The entire response must be in the second person ("you," "your") in an encouraging, and constructive tone as if to talk to the student directly.
5.  Negative Constraints: Do not give vague advice like "be more fluid," "add more energy," or "practice more." All feedback must be specific and tied to a visual observation.

I've also included some scores on a scale of 1 to 100 on how closely each joint angle in the user choreography corresponded to the original choreography below as a heuristic you can loosely refer to:
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