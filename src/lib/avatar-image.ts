/**
 * 头像在本机压缩：裁成正方形 → 128×128 → 优先 WebP，不支持就 JPEG；上限 30KB，超了降画质重压，还超就提示换图。
 * 重新编码会去掉照片里的拍摄地点、设备等信息；只上传 128px 小图，不留原图。
 */
export const AVATAR_SIDE = 128;
export const AVATAR_TARGET_BYTES = 30 * 1024;
export const AVATAR_SOURCE_MAX = 10 * 1024 * 1024;
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export function checkSource(file: File) {
  if (file.size > AVATAR_SOURCE_MAX) throw new Error("原图超过 10MB，请换一张小一点的图");
  if (file.type && !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error("只支持 JPG、PNG、WebP、HEIC 图片");
}
export async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  checkSource(file);
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // 有的浏览器 createImageBitmap 不认 HEIC：再用 <img> 试一次
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error("这张图片读不出来，请换 JPG 或 PNG");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
export interface Crop {
  /** 1 = 短边刚好填满；越大越放大 */
  zoom: number;
  /** -1～1：裁切框中心相对图片中心的偏移 */
  x: number;
  y: number;
}
/** 把裁切画到 canvas 上（预览和导出共用） */
export function drawCrop(canvas: HTMLCanvasElement, img: ImageBitmap | HTMLImageElement, crop: Crop, side = AVATAR_SIDE) {
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  const w = img.width,
    h = img.height;
  const box = Math.min(w, h) / Math.max(1, crop.zoom);
  const cx = w / 2 + (crop.x * (w - box)) / 2,
    cy = h / 2 + (crop.y * (h - box)) / 2;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, side, side);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx - box / 2, cy - box / 2, box, box, 0, 0, side, side);
}
const bytesOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
/** 导出：返回 data URL（image/webp 或 image/jpeg） */
export function encodeAvatar(img: ImageBitmap | HTMLImageElement, crop: Crop): { dataUrl: string; bytes: number; type: "webp" | "jpeg" } {
  const canvas = document.createElement("canvas");
  drawCrop(canvas, img, crop);
  for (const type of ["webp", "jpeg"] as const)
    for (const q of [0.86, 0.76, 0.64, 0.5, 0.38]) {
      const dataUrl = canvas.toDataURL(`image/${type}`, q);
      if (!dataUrl.startsWith(`data:image/${type}`)) break; // 不支持 WebP 的浏览器会退回 PNG
      const bytes = bytesOf(dataUrl);
      if (bytes <= AVATAR_TARGET_BYTES) return { dataUrl, bytes, type };
    }
  throw new Error("这张图压不到 30KB 以内，请换一张");
}
