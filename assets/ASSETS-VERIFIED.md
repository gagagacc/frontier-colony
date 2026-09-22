# 素材直链 · 复验记录（2026-09）

> `ASSETS.md` 是一份很长的素材调研（128 个链接、逐条体积与内容核对）。
> 这份文件只做一件事：**把「要真正下载的那几个包」重新验一遍，并给出可直接执行的命令**。
>
> 复验方式：本机对直链发 `HEAD`，核对 HTTP 状态码与 `Content-Length` 是否与
> `ASSETS.md` 记录一致。**状态码与字节数都一致，才算通过**（只回 200 但体积变了，
> 说明对方换了文件，需要重新核对内容）。

---

## 一、复验结果（全部通过）

| 素材包 | 用途 | 状态 | 实测字节 | ASSETS.md 记录 | 一致 |
|---|---|---|---|---|---|
| Kenney **Tower Defense (Top-Down)** | 塔防全家桶：地形 + 塔 + 敌人 + 子弹 + 障碍 | `200` | 3,298,551 | 3,298,551 | ✅ |
| Kenney **Sci-fi RTS** | 殖民地建筑 / 单位 / 飞船 / 地表 tile | `200` | 2,019,242 | 2,019,242 | ✅ |
| Kenney **UI Pack: Sci-Fi** | 科幻面板 / 按钮 / 进度条 / 9-slice | `200` | 768,505 | 768,505 | ✅ |
| Kenney **Top-down Tanks Redux** | 载具（车体与炮塔分开，可独立旋转炮塔） | `200` | 360,093 | 360,093 | ✅ |
| Kenney **Monster Builder Pack** | 模块化怪物部件（随机拼外星虫族） | `200` | 1,260,970 | 1,260,970 | ✅ |
| Kenney **Roguelike/RPG pack** | 16×16 俯视地表底图（1,700+ tiles） | `200` | 715,373 | 715,373 | ✅ |
| Buch **Colony Sim Extended**（OpenGameArt） | 题材最贴合的殖民地表 / 建筑 | `200` | 171,221 | 171,221 | ✅ |
| Buch **Colony Sim DB32** | 同上，32 色统一调色板版 | `200` | 169,153 | 169,153 | ✅ |
| **Cubic 11** 中文像素字体 woff2 | 界面中文（**必需**，网页用） | `200` | 400,228 | 400,228 | ✅ |
| **Cubic 11** 中文像素字体 ttf | 界面中文（桌面打包用） | `200` | 2,773,732 | 2,773,732 | ✅ |

**注意事项（容易踩的坑）**：

- **UI Pack: Sci-Fi 的文件名不是 slug**。作品页路径是 `ui-pack-sci-fi`，
  但 zip 叫 `kenney_ui-pack-space-expansion.zip`。按 slug 拼文件名会 404。
- **Kenney 塔防包的图块是纯编号的**（`towerDefense_tile001.png` … `tile299.png`），
  文件名不含语义。要先打开 `Tilesheet/towerDefense_tilesheet.png` 看缩略图索引，
  再把「哪张是哪种塔」回填到 `assets/manifest.json`。
- **两个网格基准不要混用**：Kenney 塔防/坦克是 **64×64**，Roguelike pack 是 **16×16**。
  本项目当前 `TILE = 40`。接素材时二选一：要么把包里的图缩放到 40，
  要么把 `TILE` 改成 64（后者要同步调 `FLOW_CELL` 与地图尺寸，见 README）。
- **像素风素材要关插值**：`ctx.imageSmoothingEnabled = false`，否则 16×16 会被糊掉。

---

## 二、下载命令（PowerShell，可直接粘）

```powershell
# 建目录
New-Item -ItemType Directory -Force -Path assets\_packs | Out-Null

$packs = @{
  'tower-defense'   = 'https://kenney.nl/media/pages/assets/tower-defense-top-down/729844df28-1677693738/kenney_tower-defense-top-down.zip'
  'sci-fi-rts'      = 'https://kenney.nl/media/pages/assets/sci-fi-rts/792bcb9cd5-1677693650/kenney_sci-fi-rts.zip'
  'ui-sci-fi'       = 'https://kenney.nl/media/pages/assets/ui-pack-sci-fi/b67c2acd31-1724181109/kenney_ui-pack-space-expansion.zip'
  'top-down-tanks'  = 'https://kenney.nl/media/pages/assets/top-down-tanks/0385fcb3e0-1677699019/kenney_top-down-tanks.zip'
  'monster-builder' = 'https://kenney.nl/media/pages/assets/monster-builder-pack/663e4ef6de-1677495438/kenney_monster-builder-pack.zip'
  'roguelike-rpg'   = 'https://kenney.nl/media/pages/assets/roguelike-rpg-pack/12c03cd78b-1677697420/kenney_roguelike-rpg-pack.zip'
  'colony-sim'      = 'https://opengameart.org/sites/default/files/colony-db32-extended.zip'
  'cjk-font-woff2'  = 'https://raw.githubusercontent.com/ACh-K/Cubic-11/main/fonts/web/Cubic_11.woff2'
  'cjk-font-ttf'    = 'https://raw.githubusercontent.com/ACh-K/Cubic-11/main/fonts/ttf/Cubic_11.ttf'
}

foreach ($k in $packs.Keys) {
  $out = "assets\_packs\$k" + $(if ($k -like 'cjk-font*') { if ($k -like '*woff2') { '.woff2' } else { '.ttf' } } else { '.zip' })
  Write-Host "下载 $k ..."
  Invoke-WebRequest -Uri $packs[$k] -OutFile $out -TimeoutSec 300
}
Write-Host "`n完成。解压："
Get-ChildItem assets\_packs\*.zip | ForEach-Object {
  Expand-Archive -Path $_.FullName -DestinationPath ("assets\_packs\" + $_.BaseName) -Force
}
```

> `assets/_packs/` 已经写进 `.gitignore`：素材体积不小，不适合进版本库；
> 真正要提交的是**你挑出来并登记进 `manifest.json` 的那几张**。

---

## 三、接进来的最短路径（三个包 + 一个字体）

已经写好的素材层是**可选的**：`assets/manifest.json` 里登记了就用贴图，
没登记就继续用程序化图形。所以可以按下面这个顺序一块一块换：

1. **先接中文字体**（收益最大、改动最小）。
   把 `Cubic_11.woff2` 放到 `assets/fonts/`，在 `index.html` 里加一条 `@font-face`，
   再把 `src/ui/style.css` 的 `font-family` 首选改成它 —— 整个界面的气质立刻变了。
2. **接地表**。从 Roguelike pack 或 Colony Sim 里切出 8~10 种地表，
   登记成 `tile.terrain.grass` / `.sand` / `.ash` / `.rock` / `.crystal` …（名字表见
   `src/core/assets.js` 的 `TILE_ASSET_NAME`）。代码侧零改动。
3. **接塔与敌人**。Tower Defense 包里的塔是编号图，挑出来登记成
   `tower.sentry` / `tower.gatling` / …；敌人用 Monster Builder 的部件，
   或者直接用塔防包里现成的敌人。渲染钩子已经在 `drawEnemyBody` / `drawPropShape` 里。
4. **最后接 UI**。UI Pack 的 9-slice 面板替换面板背景，这一步影响面最大（CSS 改动多），
   放最后做。

每一步之后跑一次 `npm run shots` 看截图，再跑 `npm run verify:all` 确认没坏。
