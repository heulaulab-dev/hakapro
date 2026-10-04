import type { MetadataRoute } from "next";
import { BRAND_NAME, BRAND_NIGHT, BRAND_TAGLINE } from "@/lib/brand";

/** Web app manifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: BRAND_TAGLINE,
    start_url: "/",
    display: "standalone",
    theme_color: BRAND_NIGHT,
    background_color: BRAND_NIGHT,
    icons: [
      { src: "/brand/png/app-icon/hakapro-appicon-dark@192w.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/png/app-icon/hakapro-appicon-dark@512w.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/png/app-icon/hakapro-appicon-dark-square@1024w.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
    ],
  };
}
