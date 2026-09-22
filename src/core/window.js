/**
 * 窗口显示控制：全屏 / 窗口大小 / 缩放。
 *
 * 两套后端，对上层是同一个接口：
 *   - 桌面（Electron）：走 preload 暴露的 window.frontier.win
 *   - 浏览器：全屏用 Fullscreen API；窗口大小浏览器基本不让改，
 *     所以退化成「提示玩家自己拉窗口」，至少全屏是能用的。
 *
 * 为什么要单独一层：设置面板不该到处写 `if (window.frontier)`。
 */

import { settings } from './settings.js';

export const WINDOW_PRESETS = [
  { id: 'auto', label: '自动', desc: '按屏幕大小自动决定' },
  { id: 'small', label: '小窗口', desc: '约占屏幕 60%' },
  { id: 'medium', label: '中等窗口', desc: '约占屏幕 75%' },
  { id: 'large', label: '大窗口', desc: '约占屏幕 88%' },
  { id: '1280x720', label: '1280 × 720', desc: '标准 16:9', w: 1280, h: 720 },
  { id: '1600x900', label: '1600 × 900', desc: '16:9', w: 1600, h: 900 },
  { id: '1920x1080', label: '1920 × 1080', desc: '16:9 全高清', w: 1920, h: 1080 },
];

const RATIO = { small: 0.6, medium: 0.75, large: 0.88, auto: 0.86 };

/** 有没有桌面端桥 */
export function isDesktop() {
  return typeof window !== 'undefined' && !!window.frontier?.win;
}

/**
 * 这一份是第几份额外实例（0 = 主实例）。
 * 多开时每一份额外的窗口会用独立的存档目录（见 electron/main.cjs），
 * 主菜单会因此提示一句，免得玩家以为「存档丢了」。
 */
export async function extraInstanceInfo() {
  try {
    // preload 把它挂在 window.frontier.info 上（见 electron/preload.cjs）
    const info = await window.frontier?.info?.();
    return {
      extra: info?.extraInstance || 0,
      shareSaves: !!info?.shareSaves,
      userData: info?.userData || null,
    };
  } catch {
    return { extra: 0, shareSaves: false, userData: null };
  }
}

/** 当前窗口状态（浏览器里用 innerWidth 近似） */
export async function getWindowState() {
  if (isDesktop()) {
    try { return await window.frontier.win.get(); } catch { /* 落到下面的降级 */ }
  }
  return {
    fullscreen: typeof document !== 'undefined' && !!document.fullscreenElement,
    maximized: false,
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
    desktop: false,
  };
}

/**
 * 进入 / 退出全屏。
 * @returns {Promise<boolean>} 操作后的全屏状态
 */
export async function setFullscreen(on) {
  if (isDesktop()) {
    try {
      const r = await window.frontier.win.setFullscreen(!!on);
      settings.setDisplay({ mode: r ? 'fullscreen' : 'window' });
      return !!r;
    } catch { /* 落到浏览器分支 */ }
  }
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch { /* 用户拒绝或不支持：保持原状 */ }
  const now = !!document.fullscreenElement;
  settings.setDisplay({ mode: now ? 'fullscreen' : 'window' });
  return now;
}

/**
 * 套用一个窗口大小预设。
 * @param {string} id WINDOW_PRESETS 里的 id
 */
export async function applyWindowSize(id) {
  settings.setDisplay({ windowSize: id, mode: 'window' });
  const preset = WINDOW_PRESETS.find(p => p.id === id);
  if (isDesktop()) {
    try {
      if (preset?.w) await window.frontier.win.setSize(preset.w, preset.h);
      else await window.frontier.win.setRatio(RATIO[id] ?? 0.86);
      return true;
    } catch { /* 落到浏览器分支 */ }
  }
  // 浏览器：resizeTo 只在「脚本打开的窗口」生效，尽力而为
  try {
    if (preset?.w && typeof window.resizeTo === 'function') {
      window.resizeTo(preset.w, preset.h);
      return true;
    }
  } catch { /* 忽略 */ }
  return false;
}

/** 启动时把设置里的显示选项应用上去 */
export async function applyDisplaySettings() {
  const { mode, windowSize } = settings.display;
  if (mode === 'fullscreen') await setFullscreen(true);
  else if (windowSize && windowSize !== 'auto') await applyWindowSize(windowSize);
}
