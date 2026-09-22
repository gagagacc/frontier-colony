/**
 * Electron 主进程 —— 把游戏包成桌面程序。
 * 开发时也可以直接用浏览器打开（tools/dev-server.mjs），两条路都能玩。
 */
const { app, BrowserWindow, ipcMain, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { steam, ACHIEVEMENTS } = require('./steam.cjs');

const isDev = !app.isPackaged;
let mainWindow = null;

/**
 * Steam App ID。
 *
 * 上架前改成你自己的 App ID（Steamworks 后台 → 应用 → App ID）。
 * 开发期设为 0：此时 steamworks.js 会去读可执行文件旁边的 `steam_appid.txt`
 * —— 那是 Valve 官方给的调试手段，**不要**把它打进正式包。
 */
const STEAM_APP_ID = Number(process.env.FRONTIER_STEAM_APPID || 0);

function savesDir() {
  const dir = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 槽位名只允许白名单字符，避免路径穿越 */
function slotPath(slot) {
  const safe = String(slot).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('非法槽位名');
  return path.join(savesDir(), `${safe}.json`);
}

function registerIpc() {
  ipcMain.handle('save:list', () => {
    const dir = savesDir();
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const full = path.join(dir, name);
      const slot = name.replace(/\.json$/, '');
      let meta = { slot, savedAt: 0, label: slot };
      try {
        const info = fs.statSync(full);
        meta.bytes = info.size;
        meta.savedAt = info.mtimeMs;
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        meta = { ...meta, ...(raw.run ? { playTime: raw.run.playTime || 0 } : {}), savedAt: raw.savedAt || info.mtimeMs };
      } catch { /* 坏档也列出来，方便玩家手动删 */ }
      out.push(meta);
    }
    return out;
  });

  ipcMain.handle('save:exists', (_e, slot) => {
    try { return fs.existsSync(slotPath(slot)); } catch { return false; }
  });

  ipcMain.handle('save:read', (_e, slot) => {
    try {
      const p = slotPath(slot);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      console.error('[save:read]', err);
      return null;
    }
  });

  ipcMain.handle('save:write', (_e, slot, data) => {
    try {
      const p = slotPath(slot);
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, p);           // 原子替换，断电也不会写坏旧档
      return true;
    } catch (err) {
      console.error('[save:write]', err);
      return false;
    }
  });

  ipcMain.handle('save:remove', (_e, slot) => {
    try {
      const p = slotPath(slot);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    } catch (err) {
      console.error('[save:remove]', err);
      return false;
    }
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    userData: app.getPath('userData'),
    dev: isDev,
    /** >0 = 这是第几份额外实例（存档目录被独立出来了）；0 = 主实例 */
    extraInstance,
    /** 额外实例是否与主实例共用存档目录（FRONTIER_SHARE_SAVES=1） */
    shareSaves,
  }));

  // ---------- Steam（成就 / 统计 / 云存档路径） ----------
  //
  // 全部走 IPC：渲染进程拿不到原生模块，也拿不到 Node 环境。
  // 没有 Steam 时这些调用全部返回安全值，游戏照常运行。

  ipcMain.handle('steam:status', () => steam.describe(app.getPath('userData')));
  ipcMain.handle('steam:unlock', (_e, id) => {
    if (!ACHIEVEMENTS[id]) return false;      // 只允许解锁已登记的成就
    return steam.unlock(id);
  });
  ipcMain.handle('steam:setStat', (_e, name, value) => {
    if (typeof name !== 'string' || name.length > 64) return false;
    return steam.setStat(name, Number(value) || 0);
  });
  ipcMain.handle('steam:store', () => steam.store());
  ipcMain.handle('steam:achievements', () => ACHIEVEMENTS);

  // ---------- 窗口控制（设置面板用） ----------

  ipcMain.handle('window:get', () => {
    if (!mainWindow) return null;
    const [w, h] = mainWindow.getSize();
    return {
      fullscreen: mainWindow.isFullScreen(),
      maximized: mainWindow.isMaximized(),
      width: w, height: h,
      workArea: screen.getPrimaryDisplay().workAreaSize,
    };
  });

  ipcMain.handle('window:setFullscreen', (_e, on) => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!!on);
    return mainWindow.isFullScreen();
  });

  /** 按「内容尺寸」调整窗口。会先退出全屏，否则改了也看不见。 */
  ipcMain.handle('window:setSize', (_e, w, h) => {
    if (!mainWindow) return false;
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    const area = screen.getPrimaryDisplay().workAreaSize;
    // 别把窗口设得比屏幕还大，否则标题栏会被顶出屏幕外拖不回来
    const nw = Math.min(Math.max(960, Math.round(w)), area.width);
    const nh = Math.min(Math.max(540, Math.round(h)), area.height);
    mainWindow.setSize(nw, nh, true);
    mainWindow.center();
    return true;
  });

  /** 按屏幕比例调整（窗口大小的「大/中/小」预设） */
  ipcMain.handle('window:setRatio', (_e, ratio) => {
    if (!mainWindow) return false;
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    const area = screen.getPrimaryDisplay().workAreaSize;
    const r = Math.min(Math.max(0.4, Number(ratio) || 0.86), 1);
    const nw = Math.round(area.width * r);
    const nh = Math.round(area.height * r);
    mainWindow.setSize(nw, nh, true);
    mainWindow.center();
    return true;
  });
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1600, Math.max(1024, Math.floor(width * 0.86)));
  const h = Math.min(950, Math.max(640, Math.floor(height * 0.9)));

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#04060c',
    title: '开拓者：殖民地',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // F12 开发者工具 / F11 全屏
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault(); }
    if (input.key === 'F11') { mainWindow.setFullScreen(!mainWindow.isFullScreen()); event.preventDefault(); }
  });

  // 外链走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 只留必要的菜单项（Alt 可唤出）
function buildMenu() {
  const template = [
    {
      label: '游戏',
      submenu: [
        { label: '全屏', accelerator: 'F11', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: '打开存档目录', click: () => shell.openPath(savesDir()) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * 单实例：**一台电脑只允许跑一份**（这是正式行为）。
 *
 * 为什么必须这样：两份进程会同时写 `%APPDATA%\<应用名>\saves\*.json`，
 * 互相覆盖（自动存档尤其容易踩），还会抢音频设备与手柄输入。
 * 玩家第二次双击时不会「什么都没发生」——主进程会把已有窗口拉到前台。
 *
 * 唯一的例外是开发/测试：设 `FRONTIER_MULTI=1` 可以同时开多份
 * （比如一边开着 `npm start`、一边验绿色版），此时每一份额外的实例
 * 会用独立存档目录 `…-2` / `…-3`，绝不会互相覆盖；
 * 再加 `FRONTIER_SHARE_SAVES=1` 则故意共用同一批存档（有覆盖风险，知情选择）。
 */
const ALLOW_MULTI = process.env.FRONTIER_MULTI === '1';
const gotLock = app.requestSingleInstanceLock();
let extraInstance = 0;
/** 额外实例是否与主实例共用存档目录（只有显式设置环境变量时才是 true） */
let shareSaves = false;
if (gotLock) {
  app.on('second-instance', () => {
    // 第二次双击：把已经开着的那份拉到前台，而不是默默什么都不做
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
} else if (!ALLOW_MULTI) {
  // 正式行为：一台机器一份。直接退出（窗口已经在上面被拉到前台了）。
  console.log('[single] 游戏已经在运行 —— 本次启动退出，已把原窗口切到前台。');
  app.quit();
} else if (process.env.FRONTIER_SHARE_SAVES === '1') {
  shareSaves = true;
  console.log('[multi] FRONTIER_SHARE_SAVES=1 —— 这一份与主实例共用存档目录（有覆盖风险）');
} else {
  /*
   * 开发用多开：换一个存档目录继续启动。
   * 目录名优先用序号（-2 / -3），撞车了再退回带 PID 的名字。
   */
  const base = app.getPath('userData');
  for (let i = 2; i <= 6; i++) {
    const dir = `${base}-${i}`;
    if (!fs.existsSync(dir)) { extraInstance = i; app.setPath('userData', dir); break; }
  }
  if (!extraInstance) {
    extraInstance = -1;
    app.setPath('userData', `${base}-p${process.pid}`);
  }
  console.log(`[multi] FRONTIER_MULTI=1 —— 这一份的存档目录：${app.getPath('userData')}`);
}

app.whenReady().then(() => {
  // Steam 要先初始化：它会影响窗口标题、成就与云存档路径。
  // 失败完全没关系 —— 没装 Steam 的机器上这就是一次静默降级。
  steam.init(STEAM_APP_ID);
  registerIpc();
  buildMenu();
  createWindow();
  // 开启 Steam 覆盖层（Shift+Tab）。放在最后：它会给渲染进程打补丁，
  // 必须在窗口创建之后调用。
  steam.enableOverlay();
  const st = steam.describe(app.getPath('userData'));
  console.log('[steam]', st.available
    ? `已连接 · AppID ${st.appId || '(来自 steam_appid.txt)'} · 玩家 ${st.player}`
    : '未连接（成就与统计只在本地记录）');
  if (st.available && !st.redistributable) {
    console.warn(`[steam] 警告：没找到 ${st.redistributableName}。`
      + '正式包必须把 Steamworks 的 redistributable 动态库放在可执行文件旁边。');
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 退出前把统计提交掉（Steam 会把它们同步到云端）
app.on('before-quit', () => { steam.store(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
