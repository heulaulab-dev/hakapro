import type { MetadataRoute } from "next";

/** Web app manifest. Colors are the brand Night token (docs/brand/tokens.json). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HAKA PRO",
    short_name: "HAKA PRO",
    description: "Read the market. Follow the flow.",
    start_url: "/",
    display: "standalone",
    theme_color: "#081720",
    background_color: "#081720",
    icons: [
      { src: "/brand/png/app-icon/hakapro-appicon-dark@192w.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/png/app-icon/hakapro-appicon-dark@512w.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/png/app-icon/hakapro-appicon-dark-square@1024w.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
    ],
  };
}
