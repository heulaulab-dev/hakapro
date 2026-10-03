import { marketRoute } from "@/server/http";
import { screenRequestSchema } from "@/server/schemas/idx-bei";

export async function POST(request: Request) {
  return marketRoute(request, { endpoint: "screener", limit: 30 }, async (source) => {
    const body: unknown = await request.json().catch(() => null);
    return source.screen(screenRequestSchema.parse(body));
  });
}
