# Steam 上架适配清单

> 这份文档是「把游戏传到 Steam」的操作手册 + 已经做好的代码适配说明。
> 代码侧的接入已经完成（成就、统计、云存档路径、打包配置、覆盖层），
> **剩下的是必须在 Steamworks 后台人工完成的部分** —— 那些是账号操作，代码替代不了。

---

## 一、代码侧已经做好的事

| 项 | 位置 | 说明 |
|---|---|---|
| Steam 桥（主进程） | `electron/steam.cjs` | 封装 `steamworks.js`；**没有 Steam 时全部静默降级**，游戏照常运行 |
| 成就触发点 | `src/main.js` 「Steam 成就」一节 | 12 个成就集中在事件订阅里，游戏逻辑不需要知道 Steam 存在 |
| 渲染侧客户端 | `src/core/steamClient.js` | 浏览器里也能安全调用；本地记录已解锁成就，用于弹提示 |
| IPC 白名单 | `electron/preload.cjs` | 只暴露 `status/unlock/setStat/store/list`，渲染进程拿不到原生模块 |
| 覆盖层 | `electron/main.cjs` | 启动时调用 `electronEnableSteamOverlay()`（Shift+Tab） |
| 云存档路径 | `electron/steam.cjs` `cloudDir()` | 存档落在 `userData/saves`，Auto-Cloud 指到这里即可 |
| 打包配置 | `package.json` → `build` | `electron-builder` 的 Windows 配置；`npm run dist:dir` 产出**带图标与版本信息**的 `dist/win-unpacked/`，这就是 depot 要传的东西 |
| 开箱产物 | `npm run dist:dir` | `Colony Frontier.exe`（ProductName / FileVersion / Company 都已写入）+ `resources/app/` |

### 打包实测记录（2026-09）

- `npm i -D electron-builder` → `npm run dist:dir` 通过，产物 278MB，exe 180MB；
  `Colony Frontier.exe` 的属性里有产品名、公司、版本号，图标是 `assets/icon.ico`（游戏自己的图标）。
- **`asar` 必须关掉**：Chromium 的 `file://` 处理器不认 asar 内部路径，
  `fetch('assets/manifest.json')` 会 `ERR_FILE_NOT_FOUND` ——
  打包版每次启动都在控制台报一条，素材清单永远加载不到（实测抓到的）。
  真要开 asar，就得把 `assets/` 挪进 `extraResources` 并改 `AssetManager` 的 base 路径。
- `build.files` 里要写 `assets/**/*`：只列 `icon.ico/icon.png` 会把 `manifest.json` 漏掉。
- `signtool` 那一步在没有证书时会跳过/告警，**不影响出包**；Steam 不要求代码签名。
- 单实例：正式行为是「一台电脑只跑一份」（第二次双击把原窗口拉到前台）。
  开发期要同时开多份（dev + 绿色版）用 `FRONTIER_MULTI=1`，额外实例会换独立存档目录。
  Steam 客户端本身也不允许同一账号同时开两份同一个 App。


### 为什么 Steam 走 IPC 而不是按官方文档直接 require

`steamworks.js` 的 README 要求在渲染进程里 `contextIsolation: false, nodeIntegration: true`。
那等于把整个 Node 环境交给页面脚本 —— 对一个会加载本地存档、以后可能加载创意工坊内容的
游戏来说代价太大。这里把 Steam 放在主进程、通过 IPC 暴露一层很窄的接口，
和现有的存档桥是同一套做法（见 `electron/preload.cjs`）。

参考：[steamworks.js README](https://github.com/ceifa/steamworks.js)（MIT，仍在维护；
`greenworks` 已停止维护，不建议新项目使用）。

---

## 二、你要在 Steamworks 后台做的事

### 1. 注册与 App ID

1. 在 [Steamworks](https://partner.steamgames.com/) 注册开发者账号，
   缴 **Steam Direct 费用（每个 App 100 美元，游戏达到一定销量后返还）**。
2. 创建 App，拿到 **App ID**。
3. 把 App ID 填进代码：设置环境变量 `FRONTIER_STEAM_APPID=<你的AppID>`，
   或者直接改 `electron/main.cjs` 里的 `STEAM_APP_ID`。

> 开发调试用 `steam_appid.txt`（内容就是 App ID，放在可执行文件旁边）。
> **这个文件绝对不能进正式包** —— `package.json` 的 `files` 里已经排除了它。

### 2. 配置成就（12 条）

Steamworks 后台 → 应用 → **Stats & Achievements** → Achievements，
逐条新建，**API Name 必须和代码里完全一致**（大小写敏感）：

| API Name | 显示名 | 说明 | 隐藏 |
|---|---|---|---|
| `ACH_FIRST_LANDING` | 脚踏实地 | 第一次降落到异星地表 | 否 |
| `ACH_FIRST_WAVE` | 守住了 | 第一次击退虫潮 | 否 |
| `ACH_FIRST_TOWER` | 空投成功 | 第一次空投防御塔 | 否 |
| `ACH_FIRST_VEHICLE` | 有车了 | 申请到第一台载具 | 否 |
| `ACH_FIRST_RED` | 一抹猩红 | 获得第一件红色装备 | 否 |
| `ACH_NEST_CLEAR` | 捣毁巢穴 | 清剿第一个虫巢 | 否 |
| `ACH_DUNGEON_BOSS` | 深入巢穴 | 击杀巢穴主 | 否 |
| `ACH_PLANET_CLAIMED` | 这颗星球归我了 | 占领一颗星球 | 否 |
| `ACH_TEN_WAVES` | 十波不倒 | 单一殖民地击退 10 波虫潮 | 否 |
| `ACH_TOWN_CITY` | 拓荒城市 | 城镇发展到「拓荒城市」 | 否 |
| `ACH_TD_MODE` | 钢铁防线 | 在纯塔防模式击退 10 波 | 否 |
| `ACH_ALL_NESTS` | 星球净化 | 清光整颗星球的虫巢 | 否 |

建议全部准备 **已解锁** 与 **未解锁** 两张图标（64×64 PNG），Steam 要求灰度/彩色两张。

### 3. 配置统计（Stats）

代码里会上报这三个统计（只增不减），需要在后台先建好同名 Stat（类型 Int）：

| Stat API Name | 含义 |
|---|---|
| `waves_survived` | 累计击退波次 |
| `nests_cleared` | 累计清剿巢穴数 |
| `planet_unlock` | 是否解锁了深空航线 |

### 4. 配置 Steam 云（Auto-Cloud）

后台 → **Steam Cloud** → 启用，然后按平台填路径：

| 平台 | 根目录 | 子目录 | 通配符 |
|---|---|---|---|
| Windows | `WinAppDataRoaming` | `<AppID>` | `saves/*.json` |
| Linux (Proton) | `WinAppDataRoaming` | `<AppID>` | `saves/*.json` |

`<AppID>` 换成你的 App ID。游戏侧存档的实际落点是：
`%APPDATA%\<AppID>\saves\*.json`
（Electron 的 `userData` 默认就是 `%APPDATA%\<应用名>`，而 Steam 会按 AppID 建目录，
所以**正式包里要把 `app.setName()` 或 productName 对齐，或者用 `--user-data-dir` 指定**。
最稳的做法是在 `electron/main.cjs` 里显式 `app.setPath('userData', ...)` 指向 AppID 目录 ——
见下面「待办」第 1 条。）

> Auto-Cloud 不需要游戏调用任何 API，只要路径对得上，Steam 会自动同步。
> 缺点是不能做「按存档槽选择性同步」，对本作（4 个槽 + 自动存档）够用。

### 5. 上传构建（Depot）

建议用一个 Depot 装 Windows 构建：

```bash
# 1) 打包（会输出到 dist/win-unpacked）
npm run dist:dir

# 2) 把 Steamworks 的 redistributable 动态库拷进去
#    路径：<steamworks.js>/sdk/redistributable_bin/win64/steam_api64.dll
copy node_modules\steamworks.js\sdk\redistributable_bin\win64\steam_api64.dll dist\win-unpacked\

# 3) 用 steamcmd 上传
steamcmd +login <账号> +run_app_build ..\..\scripts\app_build_<AppID>.vdf +quit
```

`app_build_<AppID>.vdf` 模板见本仓库 `steam/app_build.vdf.example`。

**启动项（Launch Options）**在后台配置：

| 操作系统 | 可执行文件 | 参数 |
|---|---|---|
| Windows | `Colony Frontier.exe` | （留空） |

> exe 名字就是 electron-builder 用 `productName` 生成的 `Colony Frontier.exe`。
> 想改成中文名，改 `package.json` 的 `build.productName` 再重新打包即可
> （绿色版脚本会自动找那个 exe 并改名，但 **Steam depot 建议保持 ASCII 文件名**，
> 免得部分第三方工具/日志出现编码问题）。

### 6. 商店页面素材

| 素材 | 尺寸 | 备注 |
|---|---|---|
| 主宣传图 Capsule | 616×353 | 必需 |
| 小宣传图 | 462×174 | 必需 |
| 头图 Header | 460×215 | 必需 |
| 背景图 | 1438×810 | 必需 |
| 截图 | 1920×1080 | **至少 5 张** |
| 库封面 Library | 600×900 | 必需 |
| 库主图 | 1920×620 | 必需 |
| 预告片 | 1920×1080 | 强烈建议 |

截图可以用 `npm run shots` 生成（`tools/screenshot.cjs`，会输出到 `tools/shots/`），
但**商店用的必须是真实游戏画面且不能有调试信息**（按 `F3` 关掉调试面板）。

---

## 三、待办（代码侧，上架前必须处理）

1. **把 Electron 的 userData 对齐到 AppID 目录**，否则 Auto-Cloud 找不到存档。
   在 `electron/main.cjs` 的 `app.whenReady()` 之前加：
   ```js
   if (STEAM_APP_ID) app.setPath('userData', path.join(app.getPath('appData'), String(STEAM_APP_ID)));
   ```
   （这条没有默认打开，是因为改了会让现有本地存档「消失」—— 需要配一次迁移。）

2. **装 steamworks.js 并验证**：`npm i steamworks.js`，然后跑 `npm run app`，
   看控制台有没有 `[steam] 已连接`。开发机上没开 Steam 客户端时会打印
   `[steam] 未初始化（游戏照常运行…）`，这是正常的。

3. **商店文案与本地化**：目前游戏内是纯中文。Steam 页面上架需要
   至少英文商店描述；如果要出英文版，UI 文案需要抽出来做 i18n
   （现在文案大量内联在 `src/ui/*` 与 `src/data/*`，这是一次不小的重构）。

4. **年龄分级与内容调查**：Steam 要求填写内容调查问卷
   （本作有卡通化的虫群战斗、无血腥写实内容，预计分级很低）。

5. **隐私政策**：如果以后加入遥测/崩溃上报，需要在商店页提供隐私政策链接。
   目前游戏**不收集任何数据**，可以在问卷里如实声明。

---

## 四、快速自检

```bash
npm run verify:all      # 全部 458 项断言
npx electron tools/screenshot.cjs   # 关键界面截图（人工看视觉）
npm run dist:dir        # 产出 dist/win-unpacked，可直接用 steamcmd 上传
```

打包后检查 `dist/win-unpacked/` 里：
- [ ] 有 `steam_api64.dll`
- [ ] **没有** `steam_appid.txt`
- [ ] `resources/app.asar` 存在（源码已封进 asar）
- [ ] 双击 `Colony Frontier.exe` 能直接玩（不依赖 Steam）
