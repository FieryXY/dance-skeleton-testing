import mongoose from 'mongoose';
const LevelSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        minlength: 1,
        trim: true
    },
    intervals: {
        type: [[Number]], // Array of pairs of numbers
        validate: {
            validator: function (value) {
                return value.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(n => typeof n === 'number'));
            },
            message: 'Each interval must be a pair of two numbers.'
        },
        required: true
    },
    interval_notes: {
        type: [String],
        required: false,
    },
    pose_data: {
        type: [
            {
                timestamp: { type: Number, required: true },
                poses: [
                    {
                        keypoints: [
                            {
                                x: { type: Number, required: true },
                                y: { type: Number, required: true },
                                score: { type: Number, required: true },
                                name: { type: String, required: true }
                            }
                        ]
                    }
                ]
            }
        ],
        required: true
    }
});
//Create a model for the "books" collection
const Level = mongoose.model('Level', LevelSchema);
export default Level;
