import { Injectable, Logger } from '@nestjs/common';

/**
 * TTS "loa thanh toán": đổi số tiền → câu tiếng Việt → audio MP3 (Google Translate
 * TTS). Trả audio nên chạy được trên MỌI máy/trình duyệt, không phụ thuộc giọng
 * đọc cài sẵn của hệ điều hành (khác Web Speech API ở FE).
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  /** Cache MP3 theo số tiền (bounded) để khỏi gọi Google mỗi lần cho cùng 1 số. */
  private readonly cache = new Map<number, Buffer>();
  private readonly CACHE_MAX = 200;

  private static readonly DIGITS = [
    'không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín',
  ];

  /** Đọc 1 nhóm 3 chữ số (0–999). `full` = đọc "trăm/lẻ" cho nhóm không phải nhóm đầu. */
  private static readThreeDigits(n: number, full: boolean): string {
    const hundreds = Math.floor(n / 100);
    const tens = Math.floor((n % 100) / 10);
    const units = n % 10;
    const D = TtsService.DIGITS;
    let out = '';

    if (hundreds > 0) out += `${D[hundreds]} trăm`;
    else if (full && (tens > 0 || units > 0)) out += 'không trăm';

    if (tens > 1) {
      out += ` ${D[tens]} mươi`;
      if (units === 1) out += ' mốt';
      else if (units === 5) out += ' lăm';
      else if (units > 0) out += ` ${D[units]}`;
    } else if (tens === 1) {
      out += ' mười';
      if (units === 5) out += ' lăm';
      else if (units > 0) out += ` ${D[units]}`;
    } else if (units > 0) {
      if (hundreds > 0 || full) out += ' lẻ';
      out += ` ${D[units]}`;
    }

    return out.trim();
  }

  /** Đổi số nguyên (VND) ra chữ tiếng Việt. */
  numberToVietnameseWords(value: number): string {
    let num = Math.floor(Math.abs(value || 0));
    if (num === 0) return 'không';

    const groups: number[] = [];
    while (num > 0) {
      groups.unshift(num % 1000);
      num = Math.floor(num / 1000);
    }

    const scale = ['', ' nghìn', ' triệu', ' tỷ'];
    const total = groups.length;
    const parts: string[] = [];
    for (let i = 0; i < total; i += 1) {
      if (groups[i] === 0) continue;
      const unitIndex = total - 1 - i;
      parts.push(TtsService.readThreeDigits(groups[i], i !== 0) + (scale[unitIndex] || ''));
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /** Câu loa đọc cho 1 số tiền. */
  paymentSentence(amount: number): string {
    return `Đã nhận ${this.numberToVietnameseWords(amount)} đồng`;
  }

  /** Lấy MP3 cho số tiền (có cache). Ném lỗi nếu nhà cung cấp TTS trả lỗi. */
  async paymentAudio(amount: number): Promise<Buffer> {
    const key = Math.max(0, Math.min(Math.floor(amount || 0), 999_999_999_999));
    const cached = this.cache.get(key);
    if (cached) return cached;

    const buf = await this.synthesize(this.paymentSentence(key));

    // Cache bounded — quá ngưỡng thì xoá bản cũ nhất (Map giữ thứ tự chèn).
    if (this.cache.size >= this.CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, buf);
    return buf;
  }

  /**
   * Gọi Google Translate TTS (client tw-ob, không cần API key). `q` ≤ ~200 ký tự
   * (câu số tiền luôn ngắn hơn). Cần User-Agent kiểu trình duyệt nếu không dễ 403.
   */
  private async synthesize(text: string): Promise<Buffer> {
    const url =
      'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=' +
      encodeURIComponent(text);

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
    });

    if (!res.ok) {
      this.logger.warn(`Google TTS lỗi ${res.status} cho: "${text}"`);
      throw new Error(`TTS provider trả ${res.status}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}
