import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: "./openapi.yaml",
    output: {
      mode: "single",
      target: "../api-client-react/src/generated/api.ts",
      schemas: "../api-client-react/src/generated/api.schemas.ts",
      client: "react-query",
      override: {
        title: () => "Api",
        mutator: {
          path: "../api-client-react/src/mutator.ts",
          name: "customInstance",
        },
      },
    },
  },
  "api-zod": {
    input: "./openapi.yaml",
    output: {
      mode: "single",
      target: "../api-zod/src/generated/api.ts",
      client: "zod",
      override: {
        title: () => "Api",
      },
    },
  },
});
