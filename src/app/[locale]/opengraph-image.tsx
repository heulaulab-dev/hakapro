import { SHARE_IMAGE_ALT, SHARE_IMAGE_SIZE, shareImage } from "@/components/brand/share-image";

export const alt = SHARE_IMAGE_ALT;
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default function Image() {
  return shareImage();
}
