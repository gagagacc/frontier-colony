/**
 * Preload：只暴露两个极小的、白名单化的桥给渲染进程（存档 + Steam）。
 * 渲染进程拿不到 node/fs，也拿不到原生模块，避免任何越权访问。
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
  win: {
    get: () => ipcRenderer.invoke('window:get'),
    setFullscreen: (on) => ipcRenderer.invoke('window:setFullscreen', on),
    setSize: (w, h) => ipcRenderer.invoke('window:setSize', w, h),
    setRatio: (r) => ipcRenderer.invoke('window:setRatio', r),
  },
  /**
   * Steam 桥：只有成就 / 统计 / 状态查询这几件事。
   * 想加新能力必须先在 electron/steam.cjs 里登记 —— 这是有意收窄的口子。
   */
  steam: {
    status: () => ipcRenderer.invoke('steam:status'),
    unlock: (id) => ipcRenderer.invoke('steam:unlock', id),
    setStat: (name, value) => ipcRenderer.invoke('steam:setStat', name, value),
    store: () => ipcRenderer.invoke('steam:store'),
    list: () => ipcRenderer.invoke('steam:achievements'),
  },
});
