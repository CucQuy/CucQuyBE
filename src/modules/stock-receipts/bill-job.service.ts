import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BillPipelineService, BillPipelineResult } from './bill-pipeline.service';

type JobStatus = 'processing' | 'done' | 'error';

interface BillJob {
  id: string;
  status: JobStatus;
  result?: BillPipelineResult;
  error?: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // giữ kết quả 10 phút rồi dọn.

/**
 * Chạy OCR bill dạng JOB NỀN: tách xử lý (30–120s) khỏi vòng đời HTTP request để
 * không giữ kết nối Cloudflare Tunnel lâu (tránh 520 khi mạng nhà chập chờn / quá 100s).
 * Lưu job trong RAM (job ngắn hạn, 1 replica) + tự dọn theo TTL. Pod restart mất job
 * đang chạy → FE nhận 'not found' và cho nhập lại; chấp nhận được.
 */
@Injectable()
export class BillJobService {
  private readonly logger = new Logger(BillJobService.name);
  private readonly jobs = new Map<string, BillJob>();

  constructor(private readonly pipeline: BillPipelineService) {}

  /** Tạo job + chạy OCR nền (KHÔNG await). Trả jobId ngay. */
  start(imageBase64: string): string {
    const id = randomUUID();
    const job: BillJob = { id, status: 'processing', createdAt: Date.now() };
    this.jobs.set(id, job);
    this.sweep();

    this.pipeline
      .processBill(imageBase64)
      .then((result) => {
        job.status = 'done';
        job.result = result;
      })
      .catch((e: unknown) => {
        job.status = 'error';
        job.error = e instanceof Error ? e.message : 'OCR bill thất bại.';
        this.logger.warn(`Bill job ${id} lỗi: ${job.error}`);
      });

    return id;
  }

  /** Trạng thái job (null nếu không tồn tại / đã hết hạn). */
  get(id: string): { status: JobStatus; result: BillPipelineResult | null; error?: string } | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    return {
      status: job.status,
      result: job.status === 'done' ? (job.result ?? null) : null,
      error: job.status === 'error' ? job.error : undefined,
    };
  }

  /** Dọn job cũ quá TTL. */
  private sweep(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff) this.jobs.delete(id);
    }
  }
}
