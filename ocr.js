const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const OCR_SCRIPT = path.join(__dirname, 'assets', 'ocr.ps1');
const TIMEOUT_MS = 25000;

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT, ...args],
      { windowsHide: true, timeout: TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) reject(new Error(err.killed ? 'OCR 超时' : (stderr || err.message).trim()));
        else resolve(stdout);
      }
    );
  });
}

// 识别不含任何标注的原图，保证涂鸦 / 马赛克不会遮挡 OCR。
async function recognize(dataUrl) {
  if (process.platform !== 'win32') {
    return { ok: false, error: '当前系统不支持内置 OCR（仅 Windows）' };
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) return { ok: false, error: 'OCR 需要 PNG 图片' };

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-ocr-'));
  const imagePath = path.join(workDir, 'shot.png');
  const outPath = path.join(workDir, 'result.json');
  try {
    await fs.writeFile(imagePath, Buffer.from(match[1], 'base64'));
    await runPowerShell(['-ImagePath', imagePath, '-OutPath', outPath]);
    const raw = await fs.readFile(outPath, 'utf8').catch(() => '');
    if (!raw) return { ok: false, error: 'OCR 进程未返回结果' };
    const result = JSON.parse(raw);
    if (!result.ok) return { ok: false, error: result.error || 'OCR 识别失败' };
    return {
      ok: true,
      lang: result.lang || '',
      lines: Array.isArray(result.lines) ? result.lines.filter(Boolean) : []
    };
  } catch (err) {
    return { ok: false, error: err.message || 'OCR 识别失败' };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { recognize };
