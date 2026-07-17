import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Đọc file prompt (.md) đặt cạnh service của nghiệp vụ.
 * Prompt tách ra .md để dễ đọc/sửa, không lẫn trong code.
 *
 * Dùng: `const PROMPT = loadPrompt(__dirname, 'receipt-validate.prompt.md');`
 * (nest-cli copy **\/*.md vào dist theo cấu hình assets → __dirname trong dist trỏ đúng).
 */
export function loadPrompt(dir: string, fileName: string): string {
  return readFileSync(join(dir, fileName), 'utf8').trim();
}
