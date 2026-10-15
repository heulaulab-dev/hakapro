import type { MetadataRoute } from "next";
import { resolveDeploymentEnvironment } from "@/server/config/auth";

// One image serves every environment, so read the runtime environment instead of the build's.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (resolveDeploymentEnvironment(process.env) !== "production") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/id/dev/", "/en/dev/"] }] };
}
