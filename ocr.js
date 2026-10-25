const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const OCR_SCRIPT = path.join(__dirname, 'assets', 'ocr.ps1');
const TIMEOUT_MS = 25000;
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_DATA_URL_LENGTH = 24 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 32 * 1024 * 1024;
const MAX_STDIO_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 512 * 1024;
const MAX_LINES = 10000;
const MAX_ERROR_LENGTH = 4096;
const CLEANUP_ATTEMPTS = 3;
let active = false;
// 清理失败的临时目录留待下次识别开始时重试，避免含截图/结果的文件无限累积。
const pendingCleanup = [];

function base64Value(code) {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  return code === 43 ? 62 : code === 47 ? 63 : -1;
}

function validatePng(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DATA_URL_LENGTH ||
      !dataUrl.startsWith(PNG_PREFIX)) throw new Error('OCR 需要有效且不超过 24 MiB 的 PNG 数据 URL');
  const length = dataUrl.length - PNG_PREFIX.length;
  if (length < 44 || length % 4 !== 0) throw new Error('PNG Base64 无效');
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  const end = dataUrl.length - padding;
  for (let i = PNG_PREFIX.length; i < end; i++) {
    if (base64Value(dataUrl.charCodeAt(i)) < 0) throw new Error('PNG Base64 无效');
  }
  const last = base64Value(dataUrl.charCodeAt(end - 1));
  if ((padding === 2 && (last & 15)) || (padding === 1 && (last & 3)) ||
      length / 4 * 3 - padding < 33) throw new Error('PNG Base64 无效');

  // Inspect the fixed-size header directly; do not allocate/decode the image yet.
  function byte(index) {
    const offset = PNG_PREFIX.length + Math.floor(index / 3) * 4;
    const part = index % 3;
    const a = base64Value(dataUrl.charCodeAt(offset + part));
    const b = base64Value(dataUrl.charCodeAt(offset + part + 1));
    return part === 0 ? (a << 2) | (b >> 4) :
      part === 1 ? ((a & 15) << 4) | (b >> 2) : ((a & 3) << 6) | b;
  }
  function uint32(index) {
    return byte(index) * 0x1000000 + byte(index + 1) * 0x10000 +
      byte(index + 2) * 0x100 + byte(index + 3);
  }
  const signature = '\x89PNG\r\n\x1a\n';
  for (let i = 0; i < signature.length; i++) {
    if (byte(i) !== signature.charCodeAt(i)) throw new Error('PNG 文件头无效');
  }
  if (uint32(8) !== 13 || uint32(12) !== 0x49484452) throw new Error('PNG IHDR 无效');
  const width = uint32(16);
  const height = uint32(20);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION ||
      width * height > MAX_PIXELS) throw new Error('PNG 尺寸超出限制');
  const depth = byte(24);
  const color = byte(25);
  const validDepth = color === 0 ? [1, 2, 4, 8, 16].includes(depth) :
    color === 3 ? [1, 2, 4, 8].includes(depth) :
      (color === 2 || color === 4 || color === 6) && (depth === 8 || depth === 16);
  if (!validDepth || byte(26) !== 0 || byte(27) !== 0 || byte(28) > 1) {
    throw new Error('PNG 编码不受支持');
  }
  // 独立校验 IHDR 块 CRC：错误 CRC 的 IHDR 在父端即拒绝，不依赖原生解码器。
  let crc = 0xffffffff;
  for (let i = 12; i < 29; i++) {
    crc ^= byte(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  if (((crc ^ 0xffffffff) >>> 0) !== uint32(29)) throw new Error('PNG IHDR 校验失败');
}

function errorText(value) {
  return typeof value === 'string' && value ? value.slice(0, MAX_ERROR_LENGTH).trim() : 'OCR 识别失败';
}

function delay(ms) {
  if (typeof setTimeout === 'function') return new Promise((resolve) => setTimeout(resolve, ms));
  return Promise.resolve();
}

function logCleanupFailure(dir, err) {
  try {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[OCR] 临时目录清理失败，将于下次识别重试: ' + dir + ' - ' + (err && err.message ? err.message : String(err)));
    }
  } catch { /* 日志失败不影响识别结果 */ }
}

async function removeDir(dir) {
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return null;
    } catch (err) {
      if (attempt >= CLEANUP_ATTEMPTS) return err;
      await delay(50 * attempt);
    }
  }
  return new Error('OCR 临时目录清理失败');
}

async function sweepPendingCleanup() {
  if (!pendingCleanup.length) return;
  const remaining = [];
  for (const dir of pendingCleanup) {
    if (await removeDir(dir)) remaining.push(dir);
  }
  pendingCleanup.length = 0;
  pendingCleanup.push(...remaining);
}

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT, ...args],
      { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: MAX_STDIO_BYTES },
      (err, stdout, stderr) => {
        if (err) reject(new Error(err.killed ? 'OCR 超时' : errorText(stderr || err.message)));
        else resolve();
      }
    );
  });
}

async function readResult(outPath) {
  const file = await fs.open(outPath, 'r');
  try {
    // A bounded read also covers files growing after a stat check.
    const buffer = Buffer.alloc(MAX_RESULT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_RESULT_BYTES) throw new Error('OCR 结果超出大小限制');
    return buffer.toString('utf8', 0, size);
  } finally {
    await file.close();
  }
}

// 识别不含任何标注的原图，保证涂鸦 / 马赛克不会遮挡 OCR。
async function recognize(dataUrl) {
  if (process.platform !== 'win32') {
    return { ok: false, error: '当前系统不支持内置 OCR（仅 Windows）' };
  }
  if (active) return { ok: false, error: 'OCR 正忙，请稍后重试' };
  active = true;
  if (pendingCleanup.length) await sweepPendingCleanup();
  let workDir;
  let result;
  try {
    validatePng(dataUrl);
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-ocr-'));
    const imagePath = path.join(workDir, 'shot.png');
    const outPath = path.join(workDir, 'result.json');
    const imageBytes = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
    if (imageBytes.indexOf('IDAT') < 0 || imageBytes.indexOf('IEND') < 0) {
      throw new Error('PNG 数据块不完整');
    }
    await fs.writeFile(imagePath, imageBytes);
    await runPowerShell(['-ImagePath', imagePath, '-OutPath', outPath]);
    const raw = await readResult(outPath).catch((err) => {
      if (err.code === 'ENOENT') return '';
      throw err;
    });
    if (!raw) throw new Error('OCR 进程未返回结果');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OCR 结果无效');
    if (parsed.ok !== true) throw new Error(errorText(parsed.error));
    const lang = parsed.lang || '';
    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    if (typeof lang !== 'string' || lang.length > 128 || lines.length > MAX_LINES) throw new Error('OCR 结果超出限制');
    let textLength = 0;
    const filtered = lines.filter(Boolean);
    for (const line of filtered) {
      if (typeof line !== 'string') throw new Error('OCR 结果无效');
      textLength += line.length;
      if (textLength > MAX_TEXT_LENGTH) throw new Error('OCR 文本超出限制');
    }
    result = { ok: true, lang, lines: filtered };
  } catch (err) {
    result = { ok: false, error: errorText(err && err.message) };
  } finally {
    if (workDir) {
      const cleanupError = await removeDir(workDir);
      if (cleanupError) {
        pendingCleanup.push(workDir);
        logCleanupFailure(workDir, cleanupError);
        if (result) result.cleanupFailed = true;
      }
    }
    active = false;
  }
  return result;
}

module.exports = { recognize };
