import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { join, dirname } from 'path';
// tf runtime dùng để điều khiển backend (setBackend/ready). face-api.node-wasm require
// đúng module '@tensorflow/tfjs' này (cùng singleton) nên backend set ở đây có hiệu lực.
import * as tf from '@tensorflow/tfjs';

// Dùng bản build node-wasm (thuần JS + WebAssembly) — KHÔNG dùng entry mặc định vì nó
// require '@tensorflow/tfjs-node' (native, không build được trên Alpine/node mới).
// Type lấy từ package chính, runtime nạp bản node-wasm.
import type * as FaceApiType from '@vladmandic/face-api';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const faceapi: typeof FaceApiType = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setWasmPaths } = require('@tensorflow/tfjs-backend-wasm');
// jpeg-js không kèm type → require + khai báo interface tối thiểu.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg: {
  decode: (
    buf: Buffer,
    opts?: { useTArray?: boolean },
  ) => { width: number; height: number; data: Uint8Array };
} = require('jpeg-js');

export interface FaceDetectResult {
  descriptor: number[]; // 128 số
  score: number; // độ tự tin detect (0..1)
}

/**
 * Nhận diện khuôn mặt server-side: decode ảnh → tính vector đặc trưng 128 chiều
 * (face-api tinyFaceDetector + landmark68 + faceRecognition, chạy trên WASM backend).
 * So khớp 1:1 bằng euclidean distance (nhỏ = giống). Model đóng gói ở models/face.
 */
@Injectable()
export class FaceService implements OnModuleInit {
  private readonly logger = new Logger(FaceService.name);
  private readonly modelsDir = join(process.cwd(), 'models', 'face');
  /** Ngưỡng khớp: distance ≤ ngưỡng ⇒ CÙNG người. Chỉnh qua env FACE_MATCH_THRESHOLD. */
  readonly threshold = Number(process.env.FACE_MATCH_THRESHOLD) || 0.5;
  /** inputSize TinyFaceDetector — nhỏ hơn = nhanh hơn (chỉnh qua env FACE_INPUT_SIZE). */
  private readonly inputSize = Number(process.env.FACE_INPUT_SIZE) || 320;
  private ready?: Promise<void>;

  /**
   * Nạp sẵn model NGAY lúc pod khởi động (không chờ request đầu tiên) → lần đăng ký/
   * chấm công đầu KHÔNG phải gánh chi phí init WASM + load 3 net (vốn làm "quá lâu").
   * Fire-and-forget: lỗi chỉ log, không chặn boot.
   */
  onModuleInit(): void {
    void this.ensureReady().catch((e) =>
      this.logger.warn(`Face models warm-up failed (sẽ thử lại khi có request): ${e}`),
    );
  }

  /** Nạp backend WASM + model 1 lần (lazy, dùng lại promise). */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const wasmDir =
          dirname(require.resolve('@tensorflow/tfjs-backend-wasm')) + '/';
        setWasmPaths(wasmDir);
        await tf.setBackend('wasm');
        await tf.ready();
        await faceapi.nets.tinyFaceDetector.loadFromDisk(this.modelsDir);
        await faceapi.nets.faceLandmark68Net.loadFromDisk(this.modelsDir);
        await faceapi.nets.faceRecognitionNet.loadFromDisk(this.modelsDir);
        this.logger.log(
          `Face models loaded (backend=${tf.getBackend()}, threshold=${this.threshold})`,
        );
      })().catch((e) => {
        this.ready = undefined; // cho phép thử lại lần sau
        throw e;
      });
    }
    return this.ready;
  }

  /** Ảnh JPEG (Buffer) → vector khuôn mặt + score. null nếu không thấy mặt. */
  async detect(jpegBuffer: Buffer): Promise<FaceDetectResult | null> {
    await this.ensureReady();
    let decoded: { width: number; height: number; data: Uint8Array };
    try {
      decoded = jpeg.decode(jpegBuffer, { useTArray: true }); // RGBA
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ (cần JPEG)');
    }
    const { width, height, data } = decoded;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    const input = tf.tensor3d(rgb, [height, width, 3]);
    try {
      const res = await faceapi
        .detectSingleFace(
          input as unknown as FaceApiType.TNetInput,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: this.inputSize,
            scoreThreshold: 0.4,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!res) return null;
      return {
        descriptor: Array.from(res.descriptor),
        score: res.detection.score,
      };
    } finally {
      input.dispose();
    }
  }

  /** Khoảng cách euclidean giữa 2 vector (nhỏ = giống hơn). */
  distance(a: number[], b: number[]): number {
    return faceapi.euclideanDistance(a, b);
  }

  /** Khoảng cách nhỏ nhất giữa vector mới và tập vector đã đăng ký. Infinity nếu rỗng. */
  bestDistance(descriptor: number[], samples: number[][]): number {
    let min = Infinity;
    for (const s of samples) {
      if (Array.isArray(s) && s.length === 128) {
        const d = this.distance(descriptor, s);
        if (d < min) min = d;
      }
    }
    return min;
  }
}
