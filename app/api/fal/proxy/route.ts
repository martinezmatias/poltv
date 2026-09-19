import { createRouteHandler } from "@fal-ai/server-proxy/nextjs";

const falProxy = createRouteHandler({
  resolveFalAuth: async () => {
    const falApiKey = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
    return falApiKey ? `Key ${falApiKey}` : undefined;
  },
});

export const { GET, POST, PUT } = falProxy;
