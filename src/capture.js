const MODE_NAMES = { copy: '复制图片', extract: '提取文字', translate: '翻译', edit: '编辑' };

const root = document.getElementById('cap-root');
const bg = document.getElementById('cap-bg');
const empty = document.getElementById('cap-empty');
const tip = document.getElementById('cap-tip');
const box = document.getElementById('cap-box');
const sizeTag = document.getElementById('cap-size');
const bar = document.getElementById('cap-bar');
const defaultTag = document.getElementById('cap-default');

const state = {
  image: null,
  defaultMode: 'translate',
  demo: false,
  busy: false,
  selecting: false,
  start: null,
  selection: null,
  barVisible: false
};

function generateDemoScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 1440, 900);
  grad.addColorStop(0, '#191c23');
  grad.addColorStop(1, '#101217');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1440, 900);

  ctx.fillStyle = '#22262f';
  ctx.fillRect(120, 90, 1200, 720);
  ctx.fillStyle = '#171a20';
  ctx.fillRect(120, 90, 1200, 54);
  ctx.fillStyle = '#2b3040';
  ctx.fillRect(120, 144, 320, 666);
  ctx.fillStyle = '#1b1e25';
  ctx.fillRect(440, 144, 880, 666);

  ctx.fillStyle = '#8f96a8';
  ctx.font = '600 18px "Segoe UI", sans-serif';
  ctx.fillText('Haitup Workbench · Signal 会话', 150, 124);
  ctx.fillStyle = '#c9cede';
  ctx.font = '600 17px "Segoe UI", sans-serif';
  ctx.fillText('Sophie Bernard  ·  +33 7 88 20 14 09', 480, 190);

  const bubbles = [
    { x: 500, y: 250, w: 560, h: 92, color: '#262a34', text: 'Please use Passkey to sign in.', sub: '请使用通行密钥登录。' },
    { x: 720, y: 380, w: 560, h: 92, color: '#4a3b86', text: '订单 A-2048 已发货，预计 3 天后到达里昂。', sub: 'Commande A-2048 expédiée, arrivée à Lyon sous 3 jours.' },
    { x: 500, y: 510, w: 520, h: 92, color: '#262a34', text: 'Merci, je confirme la réception.', sub: '谢谢，我确认已收到。' },
    { x: 500, y: 640, w: 600, h: 78, color: '#222630', text: '联系人：Sophie Bernard · +33 7 88 20 14 09', sub: '' }
  ];

  for (const b of bubbles) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    ctx.fillStyle = '#eef0f6';
    ctx.font = '16px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(b.text, b.x + 20, b.y + 34);
    if (b.sub) {
      ctx.fillStyle = '#b8aef0';
      ctx.font = '14px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(b.sub, b.x + 20, b.y + 62);
    }
  }

  ctx.fillStyle = '#22262f';
  ctx.fillRect(60, 840, 1320, 46);
  ctx.fillStyle = '#7f8698';
  ctx.font = '15px "Segoe UI", sans-serif';
  ctx.fillText('输入消息，Enter 发送 · Shift + Enter 换行', 90, 870);

  return canvas.toDataURL('image/png');
}

function setImage(dataUrl) {
  return new Promise((resolve) => {
    state.image = dataUrl;
    bg.onload = () => {
      empty.hidden = true;
      bg.classList.add('is-ready');
      resolve(true);
    };
    bg.onerror = () => {
      empty.textContent = '画面加载失败';
      resolve(false);
    };
    bg.src = dataUrl;
  });
}

function setTip(text) {
  tip.innerHTML = '<span class="cap-tip-key">Alt + Shift + S</span><span></span>';
  tip.lastElementChild.textContent = text;
}

function resetSelection() {
  state.selection = null;
  state.barVisible = false;
  box.hidden = true;
  bar.hidden = true;
}

function inside(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function paintBox(sel) {
  box.hidden = false;
  box.style.left = sel.x + 'px';
  box.style.top = sel.y + 'px';
  box.style.width = sel.w + 'px';
  box.style.height = sel.h + 'px';
  sizeTag.textContent = Math.round(sel.w) + ' × ' + Math.round(sel.h);
}

function placeBar() {
  if (!state.selection) return;
  bar.hidden = false;
  state.barVisible = true;
  const barW = bar.offsetWidth;
  const barH = bar.offsetHeight;
  const sel = state.selection;
  let left = sel.x;
  let top = sel.y + sel.h + 12;
  if (top + barH > window.innerHeight - 8) top = sel.y - barH - 12;
  if (top < 8) top = Math.min(window.innerHeight - barH - 8, sel.y + sel.h + 12);
  left = Math.max(8, Math.min(left, window.innerWidth - barW - 8));
  bar.style.left = left + 'px';
  bar.style.top = Math.max(8, top) + 'px';

  const mode = state.defaultMode;
  bar.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.classList.toggle('is-default', btn.dataset.mode === mode);
  });
  defaultTag.textContent = '默认：' + (MODE_NAMES[mode] || mode) + '（双击）';
}

function updateSelection(point) {
  const s = state.start;
  const x = Math.min(s.x, point.x);
  const y = Math.min(s.y, point.y);
  const w = Math.abs(point.x - s.x);
  const h = Math.abs(point.y - s.y);
  state.selection = { x, y, w, h };
  paintBox(state.selection);
  sizeTag.hidden = false;
}

function onDown(e) {
  if (e.button !== 0 || state.busy) return;
  if (e.target.closest('#cap-bar')) return;
  const point = { x: e.clientX, y: e.clientY };
  if (state.selection && state.barVisible && inside(point, state.selection)) {
    return;
  }
  state.selecting = true;
  state.barVisible = false;
  bar.hidden = true;
  state.start = point;
  state.selection = { x: point.x, y: point.y, w: 0, h: 0 };
  paintBox(state.selection);
  sizeTag.hidden = true;
}

function onMove(e) {
  if (!state.selecting) return;
  updateSelection({ x: e.clientX, y: e.clientY });
}

function onUp(e) {
  if (!state.selecting) return;
  state.selecting = false;
  updateSelection({ x: e.clientX, y: e.clientY });
  const sel = state.selection;
  if (!sel || sel.w < 8 || sel.h < 8) {
    resetSelection();
    setTip('拖动选择区域 · 双击直接执行默认模式 · Esc 取消');
    return;
  }
  placeBar();
  setTip('已选 ' + Math.round(sel.w) + ' × ' + Math.round(sel.h) + ' · 双击执行默认模式，或点下方按钮');
}

function cropSelection() {
  const sel = state.selection;
  if (!sel || !bg.naturalWidth) return null;
  const scaleX = bg.naturalWidth / window.innerWidth;
  const scaleY = bg.naturalHeight / window.innerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sel.w * scaleX));
  canvas.height = Math.max(1, Math.round(sel.h * scaleY));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    bg,
    sel.x * scaleX,
    sel.y * scaleY,
    sel.w * scaleX,
    sel.h * scaleY,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return {
    image: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height
  };
}

async function execute(mode) {
  if (state.busy || !state.selection) return;
  if (!MODE_NAMES[mode]) mode = state.defaultMode;
  const cropped = cropSelection();
  if (!cropped) return;
  state.busy = true;
  bar.classList.add('is-busy');
  setTip('正在生成选区…');
  try {
    if (window.captureOverlay) {
      await window.captureOverlay.complete({ mode, image: cropped.image });
    } else {
      window.__captureResult = { mode, image: cropped.image, width: cropped.width, height: cropped.height };
      window.dispatchEvent(new CustomEvent('capture-done', { detail: window.__captureResult }));
      setTip('演示选区完成：' + (MODE_NAMES[mode] || mode) + ' · ' + cropped.width + ' × ' + cropped.height);
    }
  } catch (err) {
    state.busy = false;
    bar.classList.remove('is-busy');
    setTip('截屏失败：' + (err.message || err));
  }
}

function cancel() {
  if (window.captureOverlay) window.captureOverlay.cancel();
  else {
    resetSelection();
    setTip('已取消，重新拖动选择区域');
  }
}

root.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);

root.addEventListener('dblclick', (e) => {
  if (e.target.closest('#cap-bar')) return;
  if (state.selection && state.barVisible) execute(state.defaultMode);
});

bar.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (btn) {
    execute(btn.dataset.mode);
    return;
  }
  if (e.target.closest('#cap-cancel')) cancel();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
    return;
  }
  if (e.key === 'Enter' && state.selection && state.barVisible) {
    e.preventDefault();
    execute(state.defaultMode);
    return;
  }
  const digit = Number.parseInt(e.key, 10);
  if (digit >= 1 && digit <= 4 && state.selection && state.barVisible) {
    execute(['copy', 'extract', 'translate', 'edit'][digit - 1]);
  }
});

async function boot() {
  let init = null;
  if (window.captureOverlay) {
    try {
      init = await window.captureOverlay.ready();
    } catch {
      init = null;
    }
  }
  if (init && init.image) {
    state.demo = false;
    state.defaultMode = MODE_NAMES[init.defaultMode] ? init.defaultMode : 'translate';
    setTip('拖动选择区域 · 双击直接执行默认模式 · Esc 取消');
  } else {
    state.demo = true;
    const queryMode = new URLSearchParams(location.search).get('mode');
    state.defaultMode = MODE_NAMES[queryMode] ? queryMode : 'translate';
    setTip('演示画面 · 拖动选择区域，双击执行默认模式');
  }
  await setImage(state.demo ? generateDemoScreen() : init.image);
}

boot();
