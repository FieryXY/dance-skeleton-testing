import { Ajv } from 'ajv';
import mongoose from 'mongoose';
const ajv = new Ajv();
function validateSchema(schema) {
    return (req, res, next) => {
        const validator = ajv.compile(schema);
        const valid = validator(req.body);
        if (!valid) {
            res.status(400);
            res.send("Malformed JSON");
            return;
        }
        next();
    };
}
function manualValidateSchema(schema, data) {
    const validator = ajv.compile(schema);
    return validator(data);
}
function validateID() {
    return (req, res, next) => {
        if (req.params.id && !isIDValid(req.params.id)) {
            res.status(400);
            res.send("Invalid ID specified in endpoint URL");
            return;
        }
        next();
    };
}
function isIDValid(idString) {
    try {
        let id = new mongoose.Types.ObjectId(idString);
        return true;
    }
    catch (e) {
        console.log(e);
        return false;
    }
}
export { isIDValid };
export { validateID };
export { manualValidateSchema };
export default validateSchema;
