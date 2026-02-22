import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { ScreenSize } from '../types/index.js';

export class ScreenshotManager {
  private scaleSize: number;

  constructor(scaleSize: number = 1000) {
    this.scaleSize = scaleSize;
  }

  /**
   * 获取屏幕尺寸
   */
  async getScreenSize(): Promise<ScreenSize> {
    const imgBuffer = await screenshot();
    const metadata = await sharp(imgBuffer).metadata();
    return {
      width: metadata.width || 1920,
      height: metadata.height || 1080
    };
  }

  /**
   * 捕获屏幕截图并调整为指定尺寸
   */
  async capture(): Promise<Buffer> {
    const imgBuffer = await screenshot();

    const resizedBuffer = await sharp(imgBuffer)
      .resize(this.scaleSize, this.scaleSize, {
        fit: 'inside',
        withoutEnlargement: false
      })
      .png()
      .toBuffer();

    return resizedBuffer;
  }

  /**
   * 将缩放后的坐标映射到实际屏幕坐标
   */
  mapCoordinates(scaledX: number, scaledY: number, screenSize: ScreenSize): { x: number; y: number } {
    const scaleX = screenSize.width / this.scaleSize;
    const scaleY = screenSize.height / this.scaleSize;

    return {
      x: Math.round(scaledX * scaleX),
      y: Math.round(scaledY * scaleY)
    };
  }

  /**
   * 将图片转换为 Base64 格式（用于 AI API）
   */
  bufferToBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }
}
