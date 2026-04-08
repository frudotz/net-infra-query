export const SCHEMAS = {
    "infra.query": {
        params: {
            bbk: { type: "string", pattern: /^\d{10}$/, required: true },
        },
    },
};
