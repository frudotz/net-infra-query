import { SCHEMAS } from './schemas.js';

export class ValidationError extends Error {
    constructor(message, details) {
        super(message);
        this.name = "ValidationError";
        this.details = details;
    }
}

export function normalizeRequest(routeName, searchParams) {
    const schema = SCHEMAS[routeName];
    if (!schema) throw new ValidationError("UNKNOWN_ROUTE");

    const normalized = {};

    for (const [key, rules] of Object.entries(schema.params)) {
        const raw = searchParams.get(key);

        if (rules.required && (raw === null || raw === "")) {
            throw new ValidationError(`MISSING_PARAM`, { param: key });
        }

        if (raw === null) continue;

        let value = raw;
        if (rules.type === "string") {
            value = raw.trim();
            if (rules.pattern && !rules.pattern.test(value)) {
                throw new ValidationError(`INVALID_FORMAT`, { param: key });
            }
        }

        normalized[key] = value;
    }

    return normalized;
}
