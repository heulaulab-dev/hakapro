import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_NAME, BRAND_NIGHT, BRAND_PAPER, BRAND_TAGLINE } from "@/lib/brand";

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };
export const SHARE_IMAGE_ALT = `${BRAND_NAME}: ${BRAND_TAGLINE}`;

// PNG, not SVG: the image renderer handles raster logos reliably. 1642×400 artwork, shown 560 wide.
const logo = readFile(join(process.cwd(), "public/brand/png/horizontal/hakapro-horizontal-color-on-dark@1200w.png"), "base64");
const LOGO_WIDTH = 560;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 400) / 1642);

/** Open Graph / Twitter card (1200×630): Night background, centered logo, tagline below. */
export async function shareImage() {
  const src = `data:image/png;base64,${await logo}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40, background: BRAND_NIGHT }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img src={src} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt={BRAND_NAME} />
        <div style={{ fontSize: 36, color: BRAND_PAPER, letterSpacing: "0.01em" }}>{BRAND_TAGLINE}</div>
      </div>
    ),
    SHARE_IMAGE_SIZE,
  );
}
