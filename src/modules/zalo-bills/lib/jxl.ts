import fs from 'node:fs';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(__filename);
// Dynamic import KHÔNG bị tsc (commonjs) hạ về require() — @jsquash là ESM-only.
const esmImport: (m: string) => Promise<any> = new Function(
  'm',
  'return import(m)',
) as any;

let ready: Promise<{ decode: (b: ArrayBuffer) => Promise<any>; encode: (img: any, o?: any) => Promise<ArrayBuffer> }> | null =
  null;

async function init() {
  const jxlDec = await esmImport('@jsquash/jxl/decode.js');
  const jpgEnc = await esmImport('@jsquash/jpeg/encode.js');
  // Nạp WASM tay (Node undici không fetch được data: URL của emscripten).
  const jxlWasm = await WebAssembly.compile(
    fs.readFileSync(nodeRequire.resolve('@jsquash/jxl/codec/dec/jxl_dec.wasm')),
  );
  const jpgWasm = await WebAssembly.compile(
    fs.readFileSync(nodeRequire.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
  );
  await jxlDec.init(jxlWasm);
  await jpgEnc.init(jpgWasm);
  return { decode: jxlDec.default, encode: jpgEnc.default };
}

function getCodecs() {
  if (!ready) ready = init();
  return ready;
}

/** Convert bytes JPEG XL → JPEG (WASM thuần, không native). Quality mặc định 82. */
export async function jxlToJpeg(jxlBytes: Buffer, quality = 82): Promise<Buffer> {
  const { decode, encode } = await getCodecs();
  const ab = jxlBytes.buffer.slice(
    jxlBytes.byteOffset,
    jxlBytes.byteOffset + jxlBytes.byteLength,
  ) as ArrayBuffer;
  const image = await decode(ab);
  const jpg = await encode(image, { quality });
  return Buffer.from(jpg);
}
