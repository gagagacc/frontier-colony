/**
 * 手柄测试专用 preload。
 * 只负责暴露与 electron/preload.cjs 相同的存档桥，保证启动流程和真实运行一致。
 *
 * 注意：假手柄不在这里装 —— contextIsolation 下 preload 有自己的 navigator，
 * 改它影响不到页面。测试改为在页面里替换 GamepadManager 的读取方法
 * （见 tools/gamepad.cjs 的 installFakePad）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frontier', {
  isDesktop: true,
  save: {
    list: () => ipcRenderer.invoke('save:list'),
    exists: (slot) => ipcRenderer.invoke('save:exists', slot),
    read: (slot) => ipcRenderer.invoke('save:read', slot),
    write: (slot, data) => ipcRenderer.invoke('save:write', slot, data),
    remove: (slot) => ipcRenderer.invoke('save:remove', slot),
  },
  info: () => ipcRenderer.invoke('app:info'),
});
