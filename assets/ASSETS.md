# 免费可商用 2D 俯视角素材清单（外星殖民塔防 + 开放世界探索）

> 项目：`frontier-colony` —— 外星殖民开荒 / 2D 俯视角塔防 + 开放大世界探索 + 城镇经营
> 本文件由调研生成，**只描述素材，不改动任何游戏代码**。
> 验证时间：**2026-09-17**（北京时间）

---

## 0. 推荐组合（如果只下载 3 个包）

| 顺序 | 素材包 | 直链体积 | 为什么是它 |
|---|---|---|---|
| **1** | **Tower Defense (Top-Down)** — Kenney | 3.1 MB | 一套包同时给到**俯视角地形 tile + 多系列防御塔 + 敌人 + 子弹 + 障碍物**（606 个文件 / 299 个唯一 64×64 与 128×128 精灵）。下载当天就能把「塔防」核心玩法跑通，不用等美术。 |
| **2** | **Sci-fi RTS** — Kenney | 1.9 MB | 外星殖民题材的**建筑 / 单位 / 飞船 / 地表 tile**（259 张 PNG，含 `Structure/` `Unit/` `Tile/` `Environment/` 四个现成分类）。补上「殖民地据点 + 开放世界地表」的美术骨架，风格与第 1 个包同源，混用不违和。 |
| **3** | **UI Pack: Sci-Fi** — Kenney | 750 KB | **科幻风面板 / 按钮 / 进度条 / 边框 / 光标**（742 张 PNG，含 Default/Double/Blue/Green/Red/Yellow/Grey 多配色 + 9-slice 可拉伸）。塔防和经营界面元素密集，这个包能让 UI 立刻从占位块变成成品；包内还附赠 `Kenney Future.ttf` 科技感字体。 |

**强烈建议追加第 4 个（几乎必装）**：**中文像素字体**——首选 **Cubic 11**（OFL-1.1，2.6 MB 单文件，最省事），
或 **缝合像素字体 Fusion Pixel Font**（OFL-1.1，字形最全），见 **§8.1**。
理由：本项目界面是中文；Kenney 全部字体只有拉丁字形，**没有它中文会退化成方块或系统字体**，前面三个包白搭。

> 三个包合计约 **5.7 MB**，全部 **CC0 1.0**（等于公有领域，商用 / 修改 / 再分发 / 免署名）。

---

## 1. 验证方法与网络环境说明（必读）

**验证手段**：本机 `curl.exe` 直接发 `HEAD`（必要时 `GET`）请求，记录 HTTP 状态码与 `Content-Length`；
大文件额外做「下载 + 解压 + 逐张读 PNG 尺寸」的内容级校验（下表中的「内容」列多数来自真实解包结果，不是文案转述）。

**本机可直连的域名（实测）**：

| 域名 | 状态 | 说明 |
|---|---|---|
| `kenney.nl` | ✅ 200 | Kenney 官方站，直链 zip 可下 |
| `opengameart.org` | ✅ 200 | OGA 作品页与 `sites/default/files/` 直链可下 |
| `raw.githubusercontent.com` | ✅ 200 | GitHub Raw |
| `api.github.com` | ✅ 200 | GitHub API |
| `codeload.github.com` | ✅ 200 | GitHub 仓库 zip 打包下载 |
| `cdn.jsdelivr.net` | ✅ 200 | GitHub 镜像 CDN（备用加速） |
| `github.com`（网页 / Releases） | ⚠️ **间歇可达** | 同一批验证里，Releases 直链**先返回过 `HTTP 302`（正常重定向到资源 CDN）**，后一轮又出现连接超时 `000`；仓库主页也时 200 时 000。**属本机网络抖动，非链接失效** |

**本机确认无法直连的域名（实测）**：`itch.io`、`0x72.itch.io`、`pixel-boy.itch.io`（均连接超时 `000`）、`fonts.google.com`、`archive.org`。
→ 因此凡是 **itch.io 独占**的素材（如 0x72 的 DungeonTileset II、Pixel-Boy 的 Ninja Adventure），
本文一律标注 **「未验证」**，只给网页地址、不给编造的直链。详见 §10。

> **对 `github.com` 抖动的处理**：凡是 `github.com/.../releases/download/...` 形式的直链，
> 本文都额外用 `api.github.com` 做了一次**权威核对**（`HTTP 200` + 精确字节数），
> 并给出稳定的 API 备用下载地址。§8.1 有具体写法。

### 1.1 验证覆盖率（自动提取本文全部链接后逐条复测）

对 **`ASSETS.md` 全文自动提取出 108 条 URL**，逐条 `curl -L` 复测，结果：

| 类别 | 条数 | 结果 |
|---|---|---|
| 可下载文件直链（zip / png / ttf / woff2 / ogg / wav / mp3 / 7z / 仓库 zip） | **100** | **除 GitHub Releases 因网络抖动出现 `000` 外，其余全部 `HTTP 200`**（详见 §8.1 说明） |
| 正文中的 URL **格式模板**（非真实链接，仅示范写法） | 4 | `cdn.jsdelivr.net/gh/` `raw.githubusercontent.com/` `kenney.nl/assets/` `kenney.nl/media/pages/assets/` —— 是路径前缀示例，**不是可下载链接** |
| itch.io 网页（`0x72` / `pixel-boy` / `kenney.itch.io`） | 3 | `000`（连接超时）→ 已在 §10 标注 **「未验证」** |
| 其他作品页 / 仓库页 | 1 | `github.com/sparklinlabs/superpowers-asset-packs` → `HTTP 200` |

**没有一条链接是凭记忆或推测写出来的**：所有 Kenney 直链都是 2026-09-17 当天从官方作品页 HTML 里实时抓取；
所有 OGA 直链来自作品页的附件 `<a href>` 与 `length=` 字节数；所有 GitHub 直链都过了 `api.github.com` 或 `raw` 实测。

**关于 Kenney 直链的稳定性**：Kenney 的下载直链形如
`https://kenney.nl/media/pages/assets/<slug>/<hash>-<timestamp>/kenney_<slug>.zip`。
`<hash>` 会随作者更新素材而变。本文所有 Kenney 直链均为 2026-09-17 从官方作品页**实时抓取并 HEAD 验证 200**；
若日后失效，请到 `https://kenney.nl/assets/<slug>` 页面点「Download」重新获取（slug 见每条的「作品页」字段）。

**授权速查**：CC0 1.0 = 公有领域贡献，**可商用、可修改、可再分发、无署名义务**；
OFL-1.1 = SIL Open Font License，**可商用、可嵌入、可再分发**（改名字体名后可再发布，字体本身不可单独售卖）；
CC-BY = 可商用但**必须署名**。本文按「优先 CC0」排序；少数非 CC0 或**需要付费**的都会显式标注出来（见 §10）。

---

## 2. 分类一：俯视角地形 tileset

> 需求：草地 / 沙地 / 岩石 / 外星地表，建议 16×16 或 32×32。

### 2.1 Roguelike/RPG pack（1,700+ tiles）—— ⭐⭐⭐ 最推荐
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/roguelike-rpg-pack/12c03cd78b-1677697420/kenney_roguelike-rpg-pack.zip`
- **作品页**：https://kenney.nl/assets/roguelike-rpg-pack
- **体积**：715,373 B（699 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：解包 11 个文件。核心是 **spritesheet**（不是散图）：`roguelikeSheet_transparent.png` / `roguelikeSheet_magenta.png` 各 968×526，含 1,700+ 个 16×16 的俯视角图块——草地、沙地、泥地、水面、石墙、树木、栅栏、房屋、家具、道具。另附 `sample_map.tmx` / `sample_indoor.tmx`（Tiled 示例地图，可直接看排版效果）。
- **本作用途**：**开放世界地表底图主力**。16×16 基准，正好配 §7 的像素字体；一张 sheet 直接切图做 terrain autotile。附带的 Tiled 示例可当 tile 索引参照表。

### 2.2 Colony Sim Extended Version —— ⭐⭐⭐ 题材最贴合
- **作者**：**Buch**（OpenGameArt）
- **授权**：**CC0 1.0**（OGA 页面 license 字段实测为 `cc0.png`）
- **直链（推荐版）**：`https://opengameart.org/sites/default/files/colony-extended.zip`
- **直链（DB32 调色板版，风格更统一）**：`https://opengameart.org/sites/default/files/colony-db32-extended.zip`
- **作品页**：https://opengameart.org/content/colony-sim-extended-version （原版：https://opengameart.org/content/colony-sim-assets ）
- **体积**：171,221 B（167 KB）/ 169,153 B（165 KB）
- **验证**：两条均 `HTTP 200`，已下载解包成功
- **内容**：解包后 3 张大图（**tilesheet**）：
  `colony-buildings-ready.png` 320×816、`colony-grounds-ready.png` 272×1040、`colony-other-ready.png` 320×2080。
  另有散图版 `colony_0.png`(24,117 B) / `colony-db32_0.png`(22,310 B)。
- **本作用途**：**最贴合「外星殖民」主题的地形/建筑素材**。`grounds` 那张就是殖民地表底图（含岩石、矿物、异星地表变体），`buildings` 直接当殖民地建筑。DB32 版用统一 32 色板，和别的素材混用时色调最不容易打架。**强烈建议与 2.1 二选一作为地表主底图**。

### 2.3 Tiny Battle —— ⭐⭐⭐ 散图最省事
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/tiny-battle/c1c25ac1f3-1691487575/kenney_tiny-battle.zip`
- **作品页**：https://kenney.nl/assets/tiny-battle
- **体积**：131,452 B（128 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：208 个文件，其中 **198 张独立 16×16 PNG**（`Tiles/` 目录，每个 tile 单独一个文件，不用切图！），外加 `tilemap.png` / `tilemap_packed.png` 两张汇总图和 `sampleMap.tmx`。
- **本作用途**：地形 tile 的**快速原型首选**——散图不用写切图代码，直接按文件名 load 就能铺地图。同系列的 `Tiny Town`(182,243 B) / `Tiny Factory`(90,463 B) 可拼殖民地城镇与工厂区。

### 2.4 Sketch Desert —— ⭐⭐ 异星荒原手绘风
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/sketch-desert/bb048a97d0-1677484250/kenney_sketch-desert.zip`
- **作品页**：https://kenney.nl/assets/sketch-desert
- **体积**：2,025,387 B（1.9 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：252 个文件，`Tiles/` 下 **244 张 256×352 的大尺寸手绘 tile**（沙丘、岩层、仙人掌、枯木、峡谷、石柱），附 `Map/` Tiled 示例。
- **本作用途**：如果最终想走高分辨率手绘风（而非 16×16 像素风），这是**唯一现成的「外星荒原」大图 tile 集**。也可只挑岩石/沙丘当高精度装饰物叠在像素地表上做分层。

### 2.5 备选：外星地表补充件
| 素材包 | 作者 | 授权 | 直链 | 体积 | 验证 | 内容 / 用途 |
|---|---|---|---|---|---|---|
| **190+ Pixel Art Assets (Sci-fi & Forest)** ⭐⭐ | OGA 用户投稿 | **CC0 1.0** | `https://opengameart.org/sites/default/files/Pack%2001%20%28Pixel%20Art%29.zip` | 8,182,088 B（7.8 MB，OGA 页面声明值） | `HTTP 200`；⚠️ 本机解压校验失败（压缩包内含非法路径字符），**内容未逐项核对** | 科幻 + 森林两套像素素材合集；用在外星植被 / 研究站外部装饰 |
| **Dungeon Crawl 32×32 tiles** ⭐⭐ | **MedicineStorm** 等 | **CC0 1.0** | `https://opengameart.org/sites/default/files/crawl-tiles%20Oct-5-2010.zip` | 2,703,511 B（2.6 MB） | `HTTP 200`（单张 sheet `DungeonCrawl_ProjectUtumnoTileset.png` 1,439,854 B 亦 200） | 32×32 大合集，岩石 / 洞穴 / 矿脉质感极强；做**外星洞窟与矿洞**地形，适合 32×32 网格方案 |
| **Roguelike Caves & Dungeons** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/roguelike-caves-dungeons/5195ceb8ca-1677694831/kenney_roguelike-caves-dungeons.zip` | 188,816 B（184 KB） | `HTTP 200` | 520 个 16×16 洞穴/地下 tile；做**地下矿洞探索**层 |
| **Simple broad-purpose tileset** ⭐ | OGA 用户投稿 | **CC0 1.0** | `https://opengameart.org/sites/default/files/simples_pimples.png` | 60,485 B | `HTTP 200` | 单张通用 tileset（`simples_pimples.png`），风格中性，适合补「过渡地形」缺口 |

---

## 3. 分类二：俯视角角色 / 怪物 sprite（含行走动画优先）

### 3.1 Top-down Shooter —— ⭐⭐⭐ 唯一自带 4 向行走动画的 Kenney 包
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/top-down-shooter/230204340a-1677694684/kenney_top-down-shooter.zip`
- **作品页**：https://kenney.nl/assets/top-down-shooter
- **体积**：2,626,248 B（2.5 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：601 个文件。角色按目录分：`Survivor 1` `Soldier 1` `Hitman 1` `Man Blue` `Man Old` `Woman Green` `Zombie 1`，每个角色 6–7 张**分帧散图**（帧尺寸约 33–57 × 43 px），即**逐帧行走/持枪动画**；另有 `Tiles/` 下 **524 张 64×64 地表 tile**（沥青、沙地、墙体）与武器图 `weapon_gun/machine/silencer`。
- **本作用途**：**玩家角色 + 人形敌人（含行走动画）主力**。殖民者、陆战队员、劫掠者直接用；`Zombie` 稍作调色即可当「被异星孢子感染的殖民者」，题材契合度很高。

### 3.2 Toon Characters 1 —— ⭐⭐⭐ 高清 4 向角色
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/toon-characters/4e8a6e4e53-1774770819/kenney_toon-characters.zip`
- **作品页**：https://kenney.nl/assets/toon-characters
- **体积**：5,474,287 B（5.2 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：698 个文件。**270 张唯一姿势图（96×128）+ 270 张 HD 版（192×256）**，另有 6 张 1728×1280 的汇总图、62+62 个可拆部件（`Parts/` `Parts HD/`）、24 张 tilesheet、6 个 SVG。
- **本作用途**：想要**比像素风更精细的角色**时用（192×256 高清版可放大不糊）。做 NPC 殖民者、科研人员、商人；配合 `Parts` 目录做换装/换头。

### 3.3 Monster Builder Pack —— ⭐⭐⭐ 自己拼外星怪物
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/monster-builder-pack/663e4ef6de-1677495438/kenney_monster-builder-pack.zip`
- **作品页**：https://kenney.nl/assets/monster-builder-pack
- **体积**：1,260,970 B（1.2 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：367 个文件，**360 张 PNG 模块化部件**（`arm_*` `leg_*` `body_*` `head_*` 等，178 个 Default + 178 个 Double 高清版），外加 4 张 spritesheet 与 SVG 矢量版。
- **本作用途**：**外星虫族的答案**。用部件程序化随机拼接即可生成大量外观各异的怪物变体（配合本项目的程序化生成思路非常合适），比固定几张怪物图更耐玩；矢量版还能任意放大做 Boss。

### 3.4 Animated Top Down Zombie —— ⭐⭐ 独立、免署名、纯动画包
- **作者**：OpenGameArt 用户投稿（`tds_zombie.zip`）
- **授权**：**CC0 1.0**
- **直链**：`https://opengameart.org/sites/default/files/tds_zombie.zip`
- **作品页**：https://opengameart.org/content/animated-top-down-zombie
- **体积**：1,933,661 B（1.8 MB）
- **验证**：`HTTP 200`
- **内容**：单包放一个俯视角僵尸的完整动画帧（行走/攻击/死亡）。
- **本作用途**：补足 3.1 里僵尸只有行走帧的缺口；也可当「感染体」小怪的基础动画模板。

### 3.5 备选角色包
| 素材包 | 作者 | 授权 | 直链 | 体积 | 验证 | 内容 / 用途 |
|---|---|---|---|---|---|---|
| **Roguelike Characters** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/roguelike-characters/53ffff4133-1729196490/kenney_roguelike-characters.zip` | 63,243 B（62 KB） | `HTTP 200`，已解包 | ⚠️ **是 spritesheet 不是散图**：内部只有 `roguelikeChar_transparent.png` / `_magenta.png`（918×203）两张 16×16 角色表（450 个角色），无行走动画。做**大量静态 NPC / 小人图标**最省体积 |
| **Shape Characters** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/shape-characters/c016420b08-1698339465/kenney_shape-characters.zip` | 546,442 B（534 KB） | `HTTP 200`，已解包 | 212 张 PNG（80×80 与 160×160），几何色块小人，含 4 向；**程序化占位期的完美过渡素材**——先用它，再逐步换成正式美术 |
| **Modular Characters** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/modular-characters/d84577feef-1677670340/kenney_modular-characters.zip` | 1,782,898 B（1.7 MB） | `HTTP 200`（未解包逐项核对） | 437 张 PNG，按 Grey/Red/White/Tan/Yellow… 配色分组的可拼装人物部件（身体/头/眉毛/发型） |
| **Superpowers Asset Packs**（含 `top-down-shooter` 角色） ⭐⭐ | Sparklin Labs | **CC0 1.0**（仓库 `LICENSE.txt` 实测为 CC0 1.0 Universal 全文，`HTTP 200`） | 整仓 zip：`https://codeload.github.com/sparklinlabs/superpowers-asset-packs/zip/refs/heads/master` | 89,497,575 B（85 MB） | `HTTP 200` | 见 §9 的 GitHub 素材仓库专节 |

---

## 4. 分类三：塔防用塔 / 建筑 / 炮塔

### 4.1 Tower Defense (Top-Down) —— ⭐⭐⭐ 首推，塔防全家桶
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/tower-defense-top-down/729844df28-1677693738/kenney_tower-defense-top-down.zip`
- **作品页**：https://kenney.nl/assets/tower-defense-top-down
- **体积**：3,298,551 B（3.1 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：606 个文件（603 PNG + SVG + SWF）。实际结构：`PNG/Retina/`(299) + `PNG/Default size/`(299) + `Tilesheet/`(2) + `Vector/`(2)。图片尺寸实测：**299 张 128×128（Retina）与 299 张 64×64（Default size）一一对应**。
- **⚠️ 命名提醒（实测）**：图块是**纯编号**的——`towerDefense_tile001.png` … `towerDefense_tile299.png`，**文件名不含语义**。要认出「哪张是哪种塔」请打开 `Tilesheet/towerDefense_tilesheet.png`（234,657 B）或 `towerDefense_tilesheet@2.png`（518,053 B）看缩略图索引，再回填到 §11.3 的 `manifest.json` 里。
- **本作用途**：**本项目塔防玩法的第一素材来源**。同一套编号里包含：地形底块（草地/沙地/岩石/水面）、多系列多等级的炮塔、敌人、子弹、障碍物、可建造标记。统一 64×64 网格，直接定义 `TILE = 64` 即可接入；`Tilesheet/` 那张同时是**天然的 texture atlas**，可直接当 SpriteSheet 用（省掉 299 次 HTTP 请求）。

### 4.2 Sci-fi RTS —— ⭐⭐⭐ 殖民地建筑 / 单位
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/sci-fi-rts/792bcb9cd5-1677693650/kenney_sci-fi-rts.zip`
- **作品页**：https://kenney.nl/assets/sci-fi-rts
- **体积**：2,019,242 B（1.9 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：265 个文件（259 PNG）。目录实测：`Unit/`(96) `Tile/`(84) `Environment/`(40) `Structure/`(32) `Spritesheet/`(4) `Tilesheet/`(3)。尺寸：126 张 128×128 + 126 张 64×64（同 4.1 的双分辨率套路），另有 2304×896 / 1152×448 大图集。
- **本作用途**：**外星殖民地骨架**。`Structure/` 直接当基地主楼、矿场、refinery、雷达站、发电厂（城镇经营 + 塔防的「可建造建筑」）；`Unit/` 当工程车/采矿单位/巡逻兵；`Tile/`+`Environment/` 铺异星地表与矿脉。风格与 4.1 完全同源，**两张表混用不会违和**。

### 4.3 Tower Defense（另一版本） —— ⭐⭐
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/tower-defense/39d625c6b5-1677699069/kenney_tower-defense.zip`
- **作品页**：https://kenney.nl/assets/tower-defense
- **体积**：1,543,710 B（1.5 MB）
- **验证**：`HTTP 200`（未解包逐项核对）
- **内容**：230 个文件。
- **本作用途**：4.1 的补充弹药库。若觉得 4.1 的塔种类不够，从这里挑额外塔型；风格一致可混用。

### 4.4 Medieval RTS —— ⭐⭐ 非科幻但可直接改色
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/medieval-rts/0863f2c62a-1677693589/kenney_medieval-rts.zip`
- **作品页**：https://kenney.nl/assets/medieval-rts
- **体积**：1,831,847 B（1.7 MB）
- **验证**：`HTTP 200`
- **内容**：120 个文件，建筑 + 单位 + 地形，结构与 4.2 同构。
- **本作用途**：给 4.2 做**形状参考或调色重绘的底稿**（CC0 允许任意修改）；也可以当「土著种族/低科技派系」的建筑，在科幻殖民地里做视觉反差。

### 4.5 备选：工业 / 工厂建筑
| 素材包 | 作者 | 授权 | 直链 | 体积 | 验证 | 内容 / 用途 |
|---|---|---|---|---|---|---|
| **Tiny Factory** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/tiny-factory/1652277319-1788860879/kenney_tiny-factory.zip` | 90,463 B（88 KB） | `HTTP 200` | 130 个 16×16 工厂/流水线/机械 tile。做**殖民地加工厂、自动采矿机、传送带** |
| **Tiny Town** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip` | 182,243 B（178 KB） | `HTTP 200` | 130 个 16×16 城镇 tile（房屋/道路/围栏）。做**殖民地居住区** |

---

## 5. 分类四：载具（车辆 / 坦克 / 飞船）

### 5.1 Top-down Tanks Redux —— ⭐⭐⭐ 带独立炮塔，塔防首选
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/top-down-tanks/0385fcb3e0-1677699019/kenney_top-down-tanks.zip`
- **作品页**：https://kenney.nl/assets/top-down-tanks
- **体积**：360,093 B（352 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：93 个文件（89 PNG），实际结构是 `PNG/`（下分 `Tanks/` `Bullets/` `Smoke/` `Obstacles/` `Environment/`）+ `Spritesheet/` + `Vector/`。**已逐文件名核对**：
  - **车体与炮管确实是分开的图**（可代码里独立旋转炮塔）：`tankBeige/Black/Blue/Green/Red.png`（车体，6 色含 `_outline` 描边版）+ `barrelBeige/Black/Blue/Green/Red.png`（炮管），另有 `barrelGreen_side.png` `barrelRed_side.png` `barrelGrey_side.png`（侧面/损毁态 `_damaged`）与 `barrelGreen_up.png` `barrelRed_up.png`。
  - 子弹 6 色 ×（实心 / 描边 / 银头）：`bulletBeige.png` `bulletBlueSilver_outline.png` …
  - **烟雾是 6 帧序列**，4 种颜色：`smokeGrey0`–`smokeGrey5`、`smokeOrange0`–`5`、`smokeWhite0`–`5`、`smokeYellow0`–`5`。
  - 地面与障碍：`grass.png` `sand.png` `dirt.png` `oil.png`（油渍贴花）、`sandbagBeige/Brown.png`、`treeLarge/Small.png`、`tracksLarge/Small.png`（履带印）。
  - 单张汇总图 `sheet_tanks.png`；尺寸从 12×26 到 98×107 不等。
- **本作用途**：**「载具类防御塔」的最佳选择**——`tank*` + `barrel*` 分离的结构让炮塔可以独立旋转瞄准敌人，塔防手感立刻上一个档次；`barrel*_damaged` 直接当**受损状态**贴图；`smoke*0–5` 当开炮/残血冒烟的序列帧动画；`tracks*` 做履带痕迹；`oil.png` 做地面污染贴花。**一个包把载具塔的「本体 + 炮塔 + 受损 + 尾迹 + 子弹」全给齐了。**

### 5.2 Pixel Vehicle Pack —— ⭐⭐⭐ 16×16 开放世界交通
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/pixel-vehicle-pack/570a4c9051-1677578609/kenney_pixel-vehicle-pack.zip`
- **作品页**：https://kenney.nl/assets/pixel-vehicle-pack
- **体积**：60,319 B（59 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：87 个文件（80 PNG）。目录：`Cars/`(50) `Characters/`(18) `Props/`(7) `Spritesheet/`(8)。单图尺寸极小（7×7 到 33×14），是**标准 16×16 像素风俯视角车辆**。
- **本作用途**：和 §2.1 的 16×16 地形**像素级对齐**，是开放世界大地图上跑运输车/侦察车/殖民者车队的正解。体积只有 59 KB，几乎零成本。

### 5.3 Racing Pack —— ⭐⭐ 大量车辆 + 道路 tile
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/racing-pack/c4cd68480a-1677662443/kenney_racing-pack.zip`
- **作品页**：https://kenney.nl/assets/racing-pack
- **体积**：1,380,632 B（1.3 MB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：442 个文件（429 PNG）。`Cars/`(50) + 道路 tile 三套各 90 张（`Asphalt road/` `Dirt road/` `Sand road/`）+ `Objects/`(39) + `Characters/`(17) + `Sand/` `Grass/` `Dirt/` 各 14。车辆与道路 tile 主要是 128×128。
- **本作用途**：道路 tile 用来**在开放世界里铺公路网 / 车辙**（`Dirt road` `Sand road` 很适合异星未铺装路面）；50 辆车当民用载具与车队。

### 5.4 飞船 / 航天器（三选）
| 素材包 | 作者 | 授权 | 直链 | 体积 | 验证 | 内容 / 用途 |
|---|---|---|---|---|---|---|
| **Space Shooter Remastered** ⭐⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/space-shooter-remastered/2cbf3c45c8-1774771931/kenney_space-shooter-remastered.zip` | 1,108,777 B（1.1 MB） | `HTTP 200` | 295 个文件，俯视角飞船（玩家机/敌机/陨石/激光/护盾/引擎火焰）。做**殖民运输船、轨道空投艇、敌方入侵飞船** |
| **Alien UFO Pack** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/alien-ufo-pack/6bc775e714-1677667399/kenney_alien-ufo-pack.zip` | 418,817 B（409 KB） | `HTTP 200` | 50 个文件，飞碟 + 牵引光束 + 光束特效。做**外星势力飞行单位 / 事件用 UFO** |
| **Simple Space** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/simple-space/b9b0968a6b-1677578143/kenney_simple-space.zip` | 318,846 B（311 KB） | `HTTP 200` | 48 个扁平配色飞船/星球，风格极简，做**占位期飞行单位**或小地图图标 |
| **16×16 Ship Collection** ⭐⭐ | OGA 用户投稿 | **CC0 1.0** | `https://opengameart.org/sites/default/files/16ShipCollection.png` | 65,743 B | `HTTP 200` | 单张 16×16 像素飞船图集，和 5.2 像素风格天然匹配 |
| **Free Top Down Car Sprites** ⭐⭐ | Unlucky Studio | **CC0 1.0** | `https://opengameart.org/sites/default/files/Topdown_vehicle_sprites_pack_Unluckystudio.zip` | 519,795 B（508 KB） | `HTTP 200`，已下载解包成功 | 15 张 **256×256** 高清俯视角车辆 + 救护车/警车动画帧（另有 700×1271 汇总图）。做**需要高清细节的特写载具** |
| **Space Starter Kit** ⭐ | OGA 用户投稿 | **CC0 1.0** | `https://opengameart.org/sites/default/files/space_starter_kit_0.zip` | 33,493 B | `HTTP 200`，已解包 | 15 个 **SVG 矢量**文件（`starship.svg` `asteroid1/2.svg` `projectile1/2.svg` `flag.svg` `space.svg`…）。矢量可无限放大，做**任意分辨率的飞船/陨石** |

---

## 6. 分类五：科幻 UI（面板 / 按钮 / 边框 / 图标）

### 6.1 UI Pack: Sci-Fi —— ⭐⭐⭐ 首推
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/ui-pack-sci-fi/b67c2acd31-1724181109/kenney_ui-pack-space-expansion.zip`
  （注意：文件名是 `kenney_ui-pack-space-expansion.zip`，但作品页 slug 是 `ui-pack-sci-fi`）
- **作品页**：https://kenney.nl/assets/ui-pack-sci-fi
- **体积**：768,505 B（750 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：1,117 个文件 = **742 PNG + 370 SVG + 2 TTF**。目录即配色变体：`Default/`(370) `Double/`(370 二倍图) `Extra/`(70) `Blue/` `Green/` `Red/` `Yellow/` `Grey/` 各 60。
  尺寸实测：54×64×64、54×128×128（同图双倍）、49×48×48、49×24×24、48×24×48、48×8×16、48×32×32、48×12×24、48×16×16、48×16×32、44×192×64、44×384×128 … —— 典型的 **9-slice 面板 + 进度条 + 按钮 + 图标**规格。
  附 **`Kenney Future.ttf` 与 `Kenney Future Narrow.ttf`** 两枚科技感字体。
- **本作用途**：**本项目 UI 主力**。`Double/` 直接供高 DPI；彩色变体可做「塔等级 / 资源类型 / 阵营」配色；9-slice 面板拉伸做建造菜单、科技树、资源栏；SVG 版可任意缩放做启动页。

### 6.2 UI Pack（通用大包） —— ⭐⭐⭐
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/ui-pack/f651646eab-1718203990/kenney_ui-pack.zip`
- **作品页**：https://kenney.nl/assets/ui-pack
- **体积**：1,229,750 B（1.2 MB）
- **验证**：`HTTP 200`
- **内容**：430 个文件，Kenney 最全的通用 UI 包（按钮、滑块、勾选框、箭头、面板、光标、图标）。
- **本作用途**：6.1 只管「科幻风」，这个包补**通用交互控件**（设置页、存档页、下拉框）。两者同源可混用。

### 6.3 Pixel UI Pack —— ⭐⭐⭐ 像素风 UI（与 16×16 素材对齐）
- **作者**：Kenney
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/pixel-ui-pack/821e760f21-1677661508/kenney_pixel-ui-pack.zip`
- **作品页**：https://kenney.nl/assets/pixel-ui-pack
- **体积**：141,881 B（139 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：40 个文件（36 PNG）。目录：`Ancient/`(12) `Colored/`(10) `Outline/`(8) `Spritesheet/`(3) `9-Slice/`(3)。尺寸：28 张 48×48、5 张 44×44，汇总图 538×592。
- **本作用途**：**像素风路线的 UI 首选**（若 §2 选了 16×16 地形，UI 就该用它而不是 6.1 的平滑风）。含 9-Slice，做可拉伸窗框。OGA 上有同包的 CC0 镜像：`https://opengameart.org/sites/default/files/PixelUIpack.zip`（`HTTP 200`）。

### 6.4 图标 / 边框 / 光标（小件补充）
| 素材包 | 作者 | 授权 | 直链 | 体积 | 验证 | 内容 / 用途 |
|---|---|---|---|---|---|---|
| **Game Icons** ⭐⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/game-icons/1ebf9c14af-1677661579/kenney_game-icons.zip` | 1,045,980 B（1.0 MB） | `HTTP 200` | 105 个图标（资源、装备、状态）。做**资源栏 / buff / 科技图标** |
| **Game Icons Expansion** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/game-icons-expansion/afac4593af-1677661643/kenney_game-icons-expansion.zip` | 2,008,440 B（1.9 MB） | `HTTP 200` | 60 个追加图标，补 6.4 上一条 |
| **Fantasy UI Borders** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/fantasy-ui-borders/ab29cd0165-1701602367/kenney_fantasy-ui-borders.zip` | 358,780 B（350 KB） | `HTTP 200` | 140 个可拉伸边框/花纹。做**对话框、任务卡、殖民地名牌**（偏奇幻，但调色后可用） |
| **Sci-fi User Interface**（`ui_sheet.png`） ⭐⭐ | **Buch**（同 §2.2 作者） | **CC0 1.0** | `https://opengameart.org/sites/default/files/ui_sheet.png` | 11,962 B | `HTTP 200` | 一张紧凑的科幻 UI sheet（另有金色版 `ui_gold_sheet.png` 12,732 B，`HTTP 200`）。**和 §2.2 的 Colony tiles 同作者，色调天然统一**，做面板边框绝配 |
| **Cursor Pack** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/cursor-pack/461b29df18-1717599281/kenney_cursor-pack.zip` | 746,901 B（729 KB） | `HTTP 200` | 180 个光标（普通/指向/禁用/攻击/建造…）。做**建造模式下的十字准星光标** |
| **Crosshair Pack** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/crosshair-pack/5ef74bd405-1785950072/kenney_crosshair-pack.zip` | 3,118,577 B（3.0 MB） | `HTTP 200` | 200 个准星。做**塔的射程/瞄准指示** |
| **Input Prompts** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/input-prompts/8de120163f-1783763952/kenney_input-prompts_1.5.zip` | 5,070,075 B（4.8 MB） | `HTTP 200` | 1,500 个键位图标（键鼠/手柄）。做**教程与快捷键提示** |
| **Minimap Pack** ⭐⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/minimap-pack/37d4e34596-1730884114/kenney_minimap-pack.zip` | 84,996 B（83 KB） | `HTTP 200` | 150 个 **小地图专用**图标（未探索迷雾、已探索、兴趣点、队友）。**开放世界必备**，体积仅 83 KB |
| **Map Pack** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/map-pack/86e20aaba9-1677662163/kenney_map-pack.zip` | 2,347,889 B（2.2 MB） | `HTTP 200` | 180 个地图标记/罗盘/图钉。做**大地图界面、任务标记** |
| **Medals** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/medals/4ed820ff57-1677699973/kenney_medals.zip` | 115,730 B（113 KB） | `HTTP 200` | 27 个勋章。做**成就 / 关卡评价** |

### 6.5 特效（塔防命中反馈，强烈建议一起下）
| 素材包 | 作者 | 授权 | 直链 | 体积 | 验证 | 内容 / 用途 |
|---|---|---|---|---|---|---|
| **Smoke Particles** ⭐⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/smoke-particles/23249a0d35-1677695171/kenney_smoke-particles.zip` | 6,019,666 B（5.7 MB） | `HTTP 200` | 70 个烟雾序列帧。**建筑被摧毁、载具尾气、爆炸余烟** |
| **Particle Pack** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip` | 15,001,764 B（14.3 MB） | `HTTP 200` | 80 组粒子（火焰/魔法/闪光/星星） |
| **Light Masks** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/light-masks/6530e254f9-1775631687/kenney_light-masks-1.0.zip` | 15,017,378 B（14.3 MB） | `HTTP 200` | 150 张光照遮罩。做**夜晚殖民地灯光、探照灯、异星昼夜循环** |
| **Splat Pack** ⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/splat-pack/1070534984-1677495350/kenney_splat-pack.zip` | 351,719 B（343 KB） | `HTTP 200` | 30 张溅射/污渍。做**怪物死亡痕迹、地面污染** |
| **Animated Explosions** ⭐⭐ | ansimuz | **CC0 1.0** | `https://opengameart.org/sites/default/files/explosions-pack.zip` | 35,061 B | `HTTP 200` | 轻量爆炸序列帧，塔防命中反馈够用 |
| **Explosion Set 1 (M484 Games)** ⭐⭐ | Master484 | **CC0 1.0** | `https://opengameart.org/sites/default/files/M484ExplosionSet1.png` | 30,189 B | `HTTP 200` | 单张爆炸序列图，**一个文件搞定所有爆炸** |
| **Pixel FX Pack** ⭐⭐ | CodeManu | **CC0 1.0** | `https://opengameart.org/sites/default/files/pixel_effects.zip` | 448,166 B | `HTTP 200` | 像素风特效包（命中/爆炸/魔法），与 16×16 素材风格统一 |
| **Sci-Fi / Space: Simple bullets** ⭐ | OGA 用户投稿 | **CC0 1.0** | `https://opengameart.org/sites/default/files/spr_bullet_strip.png` | 2,848 B（另有 3 张 strip 变体均 `HTTP 200`） | `HTTP 200` | 子弹序列条，做**能量弹/激光拖尾** |
| **Foliage Pack** ⭐⭐ | Kenney | **CC0 1.0** | `https://kenney.nl/media/pages/assets/foliage-pack/06a6c43298-1677693473/kenney_foliage-pack.zip` | 2,230,956 B（2.1 MB） | `HTTP 200` | 100 个植被（树/灌木/草）。做**外星植被层** |
| **Trees & Bushes** ⭐ | OGA 用户投稿 | **CC0 1.0** | `https://opengameart.org/sites/default/files/trees_and_bushes_pack.zip` | 192,933 B | `HTTP 200` | 俯视角树丛补充件 |

---

## 7. 分类六：音效（SFX）与 BGM

### 7.1 Kenney 音频全家桶（全部 CC0 1.0，全部 `HTTP 200` 实测）

| 素材包 | 直链 | 体积 | 内容（已解包实测） | 本作用途 |
|---|---|---|---|---|
| **Sci-Fi Sounds** ⭐⭐⭐ | `https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip` | 5,875,104 B（5.6 MB） | **73 个 .ogg**，文件名如 `computerNoise_000.ogg` `doorClose_000.ogg` `doorClose_001.ogg`，覆盖激光/引擎/力场/机械/电脑/传送 | **射击、激光、力场护盾、机械运转、传送、门禁**——科幻 SFX 主来源 |
| **Interface Sounds** ⭐⭐⭐ | `https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip` | 834,536 B（815 KB） | **100 个 .ogg**：`click_001`–`click_005` `close_001`–`close_00x` `back_001`–`back_00x` `bong_001` … | **UI 点击 / 关闭 / 返回 / 提示音**，分类清晰直接按名取用 |
| **UI Audio** ⭐⭐⭐ | `https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip` | 411,949 B（402 KB） | **52 个 .ogg**：`click1`–`click5` `mouseclick1` … | 更轻量的 UI 音效备选，可与上一条混用避免重复感 |
| **Impact Sounds** ⭐⭐⭐ | `https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip` | 800,850 B（782 KB） | 130 个撞击/打击音 | **子弹命中、护甲弹开、建筑受击** |
| **Digital Audio** ⭐⭐ | `https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip` | 990,367 B（967 KB） | 60 个电子/数字音效 | **数据面板、扫描、科技解锁** |
| **RPG Audio** ⭐⭐ | `https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip` | 964,837 B（942 KB） | 50 个（脚步/开门/拾取等） | **脚步、拾取资源、翻箱** |
| **Music Jingles** ⭐⭐ | `https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip` | 1,239,525 B（1.2 MB） | 85 个短 jingle | **胜利 / 失败 / 升级 / 解锁成就**（注意：是短提示音，**不是循环 BGM**） |
| **Voiceover Pack** ⭐ | `https://kenney.nl/media/pages/assets/voiceover-pack/3f7f168698-1677589897/kenney_voiceover-pack.zip` | 1,851,632 B（1.8 MB） | 90 个英文语音片段 | **单位应答音（"Yes sir!"）**，做即时战略式反馈（英文，无中文） |

### 7.2 OpenGameArt CC0 音效包（全部 CC0 1.0，`HTTP 200` 实测）

| 素材包 | 作者 | 直链 | 体积 | 内容 | 用途 |
|---|---|---|---|---|---|
| **50 CC0 Sci-Fi SFX** ⭐⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/sci-fi-sfx.zip` | 2,436,465 B（2.3 MB） | **已解包确认 50 个 .ogg**：`beep_01`–`beep_03` `explosion_01` `explosion_02` `loop_ambient_01` `loop_ambient_weird` `loop_machine_01`–`03` … | **含 loop 类环境音**（`loop_machine`/`loop_ambient`），可直接做**工厂底噪、异星环境氛围**；这是 Kenney 包里没有的 |
| **100 CC0 SFX** ⭐⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip` | 2,921,904 B（2.8 MB） | **已解包确认 100 个 .ogg**：`bell_01`–`03` `door_01` `door_close_01`–`04` `door_open` `dishes_01`–`04` … | 通用交互音大补货 |
| **50 CC0 retro / synth SFX** ⭐⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/50-CC0-retro-synth-SFX.zip` | 1,938,142 B（1.8 MB） | **已解包确认 50 个 .ogg + 50 个 .xpf 源文件**：`power_up_01`–`06` `retro_coin_01/02` `retro_die_01`–`03` `retro_explosion_01`–`03` … | **复古电子风**：升级、资源入账、单位死亡、爆炸。附源文件可自行改音 |
| **25 CC0 bang / firework SFX** ⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/25-CC0-bang-sfx.zip` | 1,390,498 B（1.3 MB） | 25 个爆裂/爆炸音 | **炮塔开火、建筑爆炸** |
| **Space Sound Effects** ⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/SpaceSFX1.zip` | 134,753 B（132 KB） | 太空环境音效小包 | 飞船引擎、太空氛围 |
| **Sci-Fi RTS War Unit Sounds** ⭐⭐ | qubodup | `https://opengameart.org/sites/default/files/qubodup-rts_warsounds_v2.7z` | 2,382,602 B（2.3 MB） | RTS 单位语音/机械音（`.7z`，需 7-Zip 解压） | **单位选中/移动/攻击应答**，RTS 味最正 |
| **Platformer Sounds: Terminal, Interaction, Door, Shots, Bang, Footsteps** ⭐⭐ | yd | `https://opengameart.org/sites/default/files/yd-Sounds.zip` | 172,479 B（168 KB） | **含脚步**、终端交互、门、枪声、爆炸 | 一次拿齐**终端操作 + 脚步**（体积极小） |
| **Fantozzi's Footsteps (Grass/Sand & Stone)** ⭐⭐⭐ | Fantozzi | `https://opengameart.org/sites/default/files/Fantozzi-footsteps.7z` | 476,363 B（465 KB） | 草地/沙地/石地脚步（`.7z`） | **按地形切换脚步**——外星沙地、岩石、草地各有音色，开放世界探索质感提升明显 |
| **Footsteps Leather, Cloth, Armor** ⭐ | HaelDB | `https://opengameart.org/sites/default/files/footsteps.zip` | 87,827 B（86 KB） | 皮革/布料/护甲脚步（授权 `CC0 + OGA-BY`，CC0 本身已够用） | 重甲单位脚步 |

### 7.3 BGM（科幻 / 太空环境音乐，全部 CC0 1.0，`HTTP 200` 实测）

> ⚠️ 注意：Kenney 全家桶里**没有循环 BGM**（`Music Jingles` 只是短提示音）。BGM 必须从这里取。

| 曲目 / 包 | 作者 | 直链 | 体积 | 用途 |
|---|---|---|---|---|
| **Space Music: Out There** ⭐⭐⭐ | yd | `https://opengameart.org/sites/default/files/OutThere_0.ogg` | 3,925,209 B（3.7 MB） | **开放世界探索主题曲**（单曲 .ogg，可直接循环）。太空/孤寂感，最贴合「异星开荒」 |
| **Free Music Pack**（Alexander Ehlers） ⭐⭐⭐ | Alexander Ehlers | `https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip` | 31,380,370 B（30 MB，OGA 页面声明值） | **一次拿到一整套多风格 BGM**（含电子/氛围/管弦）。⚠️ 本机仅确认 `HTTP 200`；**解压校验失败（下载被本机 60s 超时截断），包内曲目清单未逐项核对** |
| **Tower Defense Theme** ⭐⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/DST-TowerDefenseTheme_1.mp3` | 7,979,070 B（7.6 MB） | **塔防战斗 BGM**，单曲 mp3 |
| **Observing The Star** ⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/ObservingTheStar.zip` | 786,020 B（768 KB） | 太空背景音乐（体积小，适合当默认 BGM） |
| **Galactic Temple** ⭐⭐ | OGA 用户投稿 | `https://opengameart.org/sites/default/files/GalacticTemple.zip` | 1,083,496 B（1.0 MB） | 异星遗迹/神殿氛围，做**探索到古代外星遗迹**时的场景音乐 |
| **Atmospheric puzzles**（krank_music） ⭐⭐ | qubodup | `https://opengameart.org/sites/default/files/krank_music.7z` | 8,757,753 B（8.4 MB，OGA 页面声明值；本机 GET 到 1,572,528 B 后超时） | 氛围解谜音乐，做**建造模式 / 基地经营**的平静 BGM（`.7z`） |
| **Last stand in space** ⭐⭐ | HaelDB | `https://opengameart.org/sites/default/files/e.ogg` | 2,750,151 B（2.6 MB） | 太空决战曲，做**大规模虫潮来袭**的 BGM（授权 `CC0 + OGA-BY`） |
| **Loading Screen Loop** ⭐ | HaelDB | `https://opengameart.org/sites/default/files/TremLoadingloopl.wav` | 3,641,852 B（3.5 MB） | 载入界面循环音乐（同页另有 `b423b42.wav` 3,963,916 B） |
| **Superpowers 附赠 BGM** ⭐⭐ | Sparklin Labs | `https://raw.githubusercontent.com/sparklinlabs/superpowers-asset-packs/master/top-down-shooter/music/theme-1.ogg`（`theme-2/3/4.ogg` 同目录） | 780,253 B / 597,425 B / 515,110 B / 254,009 B | **CC0 1.0**，俯视角战斗 BGM 四首，直接从 GitHub Raw 拉，`HTTP 200` 实测 |

---

## 8. 分类七：字体

### 8.1 中文像素字体（**必装**，OFL-1.1，可商用）

| 字体 | 作者 | 授权 | 直链 | 体积 | 验证 |
|---|---|---|---|---|---|
| **缝合像素字体 Fusion Pixel Font** ⭐⭐⭐ **首选** | **TakWolf** | **SIL OFL 1.1**（仓库内 `LICENSE-OFL` 4418 B，`HTTP 200` 实测；代码部分另有 MIT） | 12px 比例 TTF 全量包：`https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.09.01/fusion-pixel-font-12px-proportional-ttf-v2026.09.01.zip`<br>网页用 woff2 小包：`https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.09.01/fusion-pixel-font-10px-proportional-ttf.woff2-v2026.09.01.zip` | 35,013,072 B（33 MB）/ 2,649,656 B（2.5 MB） | ⚠️ 见下方「GitHub Releases 验证说明」 |
| **方舟像素字体 Ark Pixel Font** ⭐⭐⭐ 备选 | **TakWolf** | **SIL OFL 1.1**（`LICENSE-OFL` 4412 B，`HTTP 200`） | 12px TTF：`https://github.com/TakWolf/ark-pixel-font/releases/download/2026.09.01/ark-pixel-font-12px-proportional-ttf-v2026.09.01.zip`<br>10px woff2：`https://github.com/TakWolf/ark-pixel-font/releases/download/2026.09.01/ark-pixel-font-10px-proportional-ttf.woff2-v2026.09.01.zip` | 35,026,490 B（33 MB）/ 604,310 B | 同上 |
| **俐方體 11 號 Cubic 11** ⭐⭐⭐ 单文件最省事 | **ACh-K** | **SIL OFL 1.1**（仓库根 `OFL.txt` 5364 B，`HTTP 200`） | TTF：`https://raw.githubusercontent.com/ACh-K/Cubic-11/main/fonts/ttf/Cubic_11.ttf`<br>woff2：`https://raw.githubusercontent.com/ACh-K/Cubic-11/main/fonts/web/Cubic_11.woff2` | 2,773,732 B（2.6 MB）/ 400,228 B | ✅ 均 `HTTP 200`（**本机已完整下载，字节数与 API 一致**） |

> **GitHub Releases 验证说明（重要，别被 `000` 吓到）**
> 上表两条 `github.com/.../releases/download/...` 直链，本机测试结果**不稳定**：
> 一轮返回 `HTTP 302`（正常的「重定向到 GitHub 资源 CDN」响应，说明链接有效），
> 另一轮因网络抖动返回连接超时 `000`。为排除「链接本身是错的」这一可能，另做了**权威核对**：
> - `https://api.github.com/repos/TakWolf/fusion-pixel-font/releases/latest` → **`HTTP 200`**，
>   返回的资产清单里**精确列出了上表四个文件名及其字节数**（如 `fusion-pixel-font-12px-proportional-ttf-v2026.09.01.zip` = `35013072`，与上表完全一致）；
> - 用 API 资产地址 `https://api.github.com/repos/TakWolf/fusion-pixel-font/releases/assets/<asset_id>`
>   加请求头 `Accept: application/octet-stream` → **`HTTP 200`**。
> **结论：链接有效、资源存在、体积已核对；若你的网络也连不上 `github.com`，请改用上面这个 API 地址，或让能访问 GitHub 的环境代下。**
> 也可用镜像仓库查看源码：`https://raw.githubusercontent.com/TakWolf/fusion-pixel-font/master/README.md`（`HTTP 200`）。
> 建议：**优先用 §8.1 第三条 Cubic 11**（走 `raw.githubusercontent.com`，本机 `HTTP 200` 稳定可下，无需碰 GitHub Releases）。

> **选型建议**：Cubic 11 是**单个 2.6 MB 文件**、覆盖常用繁体/简体汉字，接入成本最低，**建议先上它**；
> Fusion Pixel 字形最全（含日文假名、更多生僻字）且提供 8/10/12px 与等宽/比例两套，**中文字数多、需要严格对齐数字时换它**。
> **别用 `woff`**：本项目的 `tools/dev-server.mjs` MIME 表里有 `.woff2` `.ttf`，**没有 `.woff`**，用 woff 会被当成 `application/octet-stream`。

### 8.2 科幻风拉丁字体（OFL-1.1，Google Fonts，全部 `HTTP 200` 实测）

用于标题、数字、代号、LOGO（中文正文仍用 §8.1）。

| 字体 | 风格 | 直链 | 体积 |
|---|---|---|---|
| **Orbitron** ⭐⭐⭐ | 经典科幻几何无衬线，标题神字 | `https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/Orbitron%5Bwght%5D.ttf` | 38,576 B |
| **Oxanium** ⭐⭐⭐ | 游戏化科幻字体，UI 数字很帅 | `https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/Oxanium%5Bwght%5D.ttf` | 43,536 B |
| **Audiowide** ⭐⭐ | 复古未来风，LOGO 用 | `https://raw.githubusercontent.com/google/fonts/main/ofl/audiowide/Audiowide-Regular.ttf` | 69,916 B |
| **Rajdhani** ⭐⭐ | 印度风科技感，半粗体做面板标题 | `https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/Rajdhani-Bold.ttf` | 400,680 B |
| **Share Tech Mono** ⭐⭐ | 终端/数据等宽 | `https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/ShareTechMono-Regular.ttf` | 43,272 B |
| **Press Start 2P** ⭐⭐ | 8-bit 像素英文，配像素风 UI | `https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/PressStart2P-Regular.ttf` | 118,204 B |

### 8.3 Kenney 字体（CC0 1.0）
- **Kenney Fonts** ⭐⭐
- **授权**：**CC0 1.0**
- **直链**：`https://kenney.nl/media/pages/assets/kenney-fonts/8d5435c213-1677661710/kenney_kenney-fonts.zip`
- **作品页**：https://kenney.nl/assets/kenney-fonts
- **体积**：57,786 B（56 KB）
- **验证**：`HTTP 200`，已下载解包成功
- **内容**：**12 个 .ttf**：`Kenney Blocks` `Kenney Future` `Kenney Future Narrow` `Kenney High` `Kenney High Square` `Kenney Mini` `Kenney Mini Square` `Kenney Mini Square Mono` `Kenney Pixel Square` …
- **本作用途**：CC0 免署名，做 **UI 数字、按钮文字、版本号**。`Kenney Mini Square Mono` 是等宽，适合资源栏数字对齐。**注意：无中文字形。**

---

## 9. GitHub 上的开源素材仓库（可被 `raw.githubusercontent.com` / `codeload` 直接拉取）

### 9.1 Superpowers Asset Packs —— ⭐⭐⭐ 强烈推荐
- **作者**：**Sparklin Labs**
- **授权**：**CC0 1.0**（仓库根 `LICENSE.txt` 实测为 CC0 1.0 Universal 全文，`HTTP 200`，6,555 B）
- **仓库页**：`https://github.com/sparklinlabs/superpowers-asset-packs`（实测 `HTTP 200`，但如 §1 所述 `github.com` 时好时坏）
- **整仓 zip 直链**：`https://codeload.github.com/sparklinlabs/superpowers-asset-packs/zip/refs/heads/master`
- **体积**：89,497,575 B（85 MB）—— 已实测 `HTTP 200` 完整下载
- **验证**：仓库 LICENSE / 各子目录 / 具体文件均逐个 `HTTP 200` 实测
- **内容**（实测目录）：`top-down-shooter/` `space-shooter/` `ninja-adventure/` `rpg-battle-system/` `medieval-fantasy/` `prehistoric-platformer/` `western-fps-2d/` `backgrounds/` `3d-*`
  - `top-down-shooter/`：`characters/`（`tank.png` 5,753 B、`tank-base.png`、`tank-cannon.png`、`body/` `head/` `robot/` `turret/` `leg-animation.png`）· `sounds/`（**17 个 wav**：`shoot-1/2/3.wav` `explosion-1/2/3.wav` `hit.wav` `death.wav` `flame-thrower.wav` `sword-1/2.wav` `alert.wav` `cure.wav` `no-ammo.wav` `shoot-destroy.wav` `window-hit-1/2.wav`）· `music/`（4 首 .ogg）· `weapons/` `hud/` `effects/` `item/` `background/`
  - `space-shooter/`：`ships/` `shots/` `effects/` `hud/` `items/` `music/` `sounds/` `backgrounds/`
- **本作用途**：**单条命令拿到 85 MB CC0 素材**，覆盖角色/载具（坦克）/音效/BGM/UI。特别是 `top-down-shooter/sounds/` 的 17 个 wav **正好补齐「射击 / 爆炸 / 命中」三件套**，和 §7.1 的 Kenney 音效互为备份。
- **单文件直链示例**（均可直接 `raw` 拉）：
  `https://raw.githubusercontent.com/sparklinlabs/superpowers-asset-packs/master/top-down-shooter/sounds/shoot-1.wav`（78,308 B，`HTTP 200`）
  `https://raw.githubusercontent.com/sparklinlabs/superpowers-asset-packs/master/top-down-shooter/characters/tank.png`（5,753 B，`HTTP 200`）
  `https://raw.githubusercontent.com/sparklinlabs/superpowers-asset-packs/master/top-down-shooter/music/theme-1.ogg`（780,253 B，`HTTP 200`）

### 9.2 其他可用的 GitHub 素材仓库（**未逐项验证内容，仅登记**）
| 仓库 | 授权（API 读取） | 说明 | 状态 |
|---|---|---|---|
| `Papyszoo/CC0-Public-Domain-Sprites` | **CC0-1.0** | CC0 2D 精灵 / UI kit / tileset / 图标合集，约 172 MB | 仓库存在（`api.github.com` 200）；**包内内容未验证** |
| `Tiddybub/2d-assets` | NOASSERTION | 按题材整理的免费 CC0 2D 素材索引（约 1.09 GB）。**授权字段无法自动判定，使用前须逐个核对** | 仓库存在；**授权未验证** |
| `ETdoFresh/kenney.nl` / `iwenzhou/kenney` | 无 / **CC0-1.0** | Kenney 素材的第三方镜像。**建议优先用本文的 kenney.nl 官方直链**，镜像仅作备用 | 仓库存在；**镜像完整性未验证** |
| `phnix-dev/kenney-assets-helper` | — | 只是 Kenney 素材管理工具，**不含素材本体** | 仅供参考 |

> **镜像加速提示**：若 `raw.githubusercontent.com` 在某些网络下不稳，可把
> `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`
> 换成 `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>`（实测 `HTTP 200`）。
> ⚠️ jsDelivr **不代理 GitHub Releases 资源**，所以 §8.1 的字体 release zip 不能用它加速。

---

## 10. 避坑 / 明确不推荐

| 素材 | 问题 | 结论 |
|---|---|---|
| **Zpix 最像素字体**（`SolidZORO/zpix-pixel-font`） | README 的 License 段落写明：**单个商业产品 RMB ¥7000**，属**付费授权**，不是免费商用 | ❌ **绝对不要用**（很多人误以为它是免费像素字体） |
| **0x72 的 DungeonTileset II**（`https://0x72.itch.io/dungeontileset-ii`） | 该素材**实际授权是 CC0**，质量很高、16×16 带角色行走动画，**但只发布在 itch.io**；本机网络**无法访问 itch.io**（`curl` 连接超时，状态 `000`），也**没找到可信的 GitHub 镜像**（`api.github.com` 搜 `DungeonTilesetII` → `404 Not Found`） | ⚠️ **未验证**。地址仅供参考，请自行在能访问 itch.io 的环境下载并**当场确认页面上的 CC0 声明**。**不要把它写进自动下载脚本** |
| **Pixel-Boy 的 Ninja Adventure Asset Pack**（`https://pixel-boy.itch.io/ninja-adventure-asset-pack`） | 同样是 itch.io 独占（CC0），本机不可达；GitHub 上未找到官方镜像 | ⚠️ **未验证**，同上 |
| **Kenney All-in-1 付费包**（`https://kenney.itch.io/kenney-game-assets`） | 是**付费**合集（itch.io）；但其中每一个单独素材包在 kenney.nl 上都免费且 CC0 | ✅ 不必买；用本文的 kenney.nl 直链即可拿到全部所需包 |
| **LPC / Liberated Pixel Cup 系列** | 多数是 **CC-BY-SA 3.0 / GPL**（可商用，但**传染性 Share-Alike**，且需署名） | ⚠️ 本项目**未收录**。若要用，须评估「衍生作品也必须 CC-BY-SA」对闭源商业发行的限制 |
| **OpenGameArt 上标 `CC-BY` 的条目** | 可商用但**强制署名** | 本文只收录 **CC0** 条目；若后续要用 CC-BY，务必在 `CREDITS` 里列出作者与链接 |

---

## 11. 接入约定（`assets/` 目录组织与命名规范）

> 本项目的静态根目录是**仓库根**（见 `tools/dev-server.mjs`：`ROOT = resolve(...'..')`），
> 所以 `assets/tiles/terrain/tile-sand-01.png` 在浏览器里的 URL 就是
> **`http://127.0.0.1:5173/assets/tiles/terrain/tile-sand-01.png`**（注意：素材真正放好后才有这个地址，
> 放之前访问该路径会返回 `404`，属正常现象）。
> 该服务器 **只读**、按 `mtime` 失效缓存、`Cache-Control: no-store`——改完素材刷新即可见，无需重启。

### 11.1 目录结构

```
assets/
├── ASSETS.md              # 本文件（素材清单与授权台账）
├── raw/                   # ① 原封不动下载的素材包，只增不改
│   ├── kenney/            #    按来源分
│   │   ├── tower-defense-top-down/   # 解压后的原始目录，保持原样
│   │   ├── sci-fi-rts/
│   │   └── ui-pack-sci-fi/
│   ├── opengameart/
│   │   ├── colony-sim-extended/
│   │   └── 50-cc0-sci-fi-sfx/
│   └── github/
│       └── sparklinlabs-superpowers-asset-packs/
│
├── tiles/                 # ② 从 raw 里挑出来、真正进游戏的地形 tile
│   ├── terrain/           #    地表底图：sand / grass / rock / alien-*
│   ├── decor/             #    装饰：树、灌木、岩石、矿脉
│   └── atlas-terrain.png  #    打包后的图集（由脚本生成，勿手改）
│
├── sprites/
│   ├── units/             #    殖民者、工程兵、玩家单位
│   ├── enemies/           #    外星虫族、感染体、Boss
│   ├── towers/            #    防御塔（含 base / turret 分层）
│   ├── vehicles/          #    车辆、坦克、飞船
│   ├── buildings/         #    殖民地建筑、工厂、矿场
│   └── fx/                #    爆炸、烟雾、枪口火焰、命中特效
│
├── ui/
│   ├── panels/            #    9-slice 面板与边框
│   ├── buttons/           #    按钮各状态
│   ├── icons/             #    资源 / 科技 / buff 图标
│   ├── cursors/           #    光标、准星
│   └── minimap/           #    小地图图标（迷雾、兴趣点）
│
├── fonts/
│   ├── Cubic_11.ttf
│   ├── Orbitron[wght].ttf
│   └── ...
│
├── audio/
│   ├── sfx/               #    射击 / 爆炸 / 脚步 / UI 点击
│   └── bgm/               #    循环 BGM
│
└── manifest.json          # ③ 由脚本生成的资产索引（代码只读这个）
```

### 11.2 命名规范

**通用规则**
1. **全小写 + `kebab-case`**，只允许 `a-z 0-9 - .`，**禁止空格、中文、括号、大写**（跨平台 + URL 安全）。
2. **带尺寸后缀**：`_64x64`、`_128x128`。同一素材有多分辨率时必须带，避免代码里猜。
3. **带动画帧号**：`_f00`、`_f01`…（从 00 开始，补零对齐）。
4. **带方向后缀**：`_n` `_e` `_s` `_w`（北/东/南/西）；8 向用 `_ne` `_se` `_sw` `_nw`。
5. `raw/` 下的文件**保持下载原样、不改名**，方便日后重新下载时做 diff；改名只发生在复制进 `tiles/ sprites/ ui/ …` 时。

**各目录示例**

| 目录 | 规范 | 示例 |
|---|---|---|
| `tiles/terrain/` | `tile-<地形>-<变体>.png` | `tile-sand-01.png`、`tile-alien-rock-03.png` |
| `tiles/decor/` | `decor-<类型>-<变体>.png` | `decor-tree-alien-02.png` |
| `sprites/units/` | `unit-<种类>-<动作>-<方向>_f<帧>.png` | `unit-colonist-walk-s_f00.png`、`unit-engineer-idle-n_f00.png` |
| `sprites/enemies/` | `enemy-<种类>-<动作>-<方向>_f<帧>.png` | `enemy-bugling-walk-e_f02.png`、`enemy-broodmother-attack-s_f00.png` |
| `sprites/towers/` | `tower-<类型>-t<等级>-<部件>.png` | `tower-laser-t1-base.png`、`tower-laser-t1-turret.png`（**炮塔单独一层，便于旋转瞄准**） |
| `sprites/vehicles/` | `vehicle-<种类>-<方向>.png` | `vehicle-hauler-e.png`、`vehicle-tank-turret-s.png` |
| `sprites/buildings/` | `bld-<功能>-t<等级>.png` | `bld-refinery-t1.png`、`bld-habitat-t2.png` |
| `sprites/fx/` | `fx-<类型>_f<帧>.png` | `fx-explosion-small_f03.png`、`fx-muzzle-flash_f00.png` |
| `ui/panels/` | `<用途>-<风格>.png` | `panel-buildmenu-sci-fi.png`（9-slice，务必记录切边像素，见 manifest） |
| `ui/icons/` | `icon-<语义>.png` | `icon-resource-metal.png`、`icon-tech-laser.png` |
| `ui/cursors/` | `cursor-<状态>.png` | `cursor-build.png`、`cursor-attack.png` |
| `audio/sfx/` | `<分类>-<动作>-<变体>.ogg` | `sfx-shoot-laser-01.ogg`、`sfx-ui-click-02.ogg`、`sfx-step-sand-03.ogg` |
| `audio/bgm/` | `bgm-<场景>.ogg` | `bgm-explore.ogg`、`bgm-combat.ogg`、`bgm-colony.ogg` |
| `fonts/` | `<FontName>[-<weight>].<ext>` | `Cubic_11.ttf`、`Orbitron-Bold.ttf` |

**音效格式约定**：统一转成 **`.ogg`**（Kenney 与 OGA 的 CC0 包绝大多数本来就是 `.ogg`，且 `dev-server.mjs` 的 MIME 表里有 `.ogg`）。若要用 `.mp3`/`.wav` 也在 MIME 表内；**`.opus` / `.flac` 不在表内**，会以 `application/octet-stream` 返回，别用。

### 11.3 `manifest.json` 的 ID 约定（供代码按图索骥）

逻辑 ID 用小写点分命名空间 `<域>.<对象>.<属性>`，**与文件路径解耦**，换素材只改 manifest、不动代码：

| 域 | ID 示例 | 指向 |
|---|---|---|
| `tile` | `tile.terrain.sand`、`tile.terrain.alien-rock` | `tiles/terrain/tile-sand-01.png` |
| `unit` | `unit.colonist.walk.s`（值为帧数组） | `sprites/units/unit-colonist-walk-s_f00.png` … |
| `enemy` | `enemy.bugling.walk.e` | `sprites/enemies/…` |
| `tower` | `tower.laser.t1`（对象：`{ base, turret, range, icon }`） | `sprites/towers/…` + `ui/icons/icon-tech-laser.png` |
| `vehicle` | `vehicle.hauler` | `sprites/vehicles/…` |
| `building` | `bld.refinery.t1` | `sprites/buildings/…` |
| `ui` | `ui.panel.buildmenu`（对象带 `slice: [l,t,r,b]`） | `ui/panels/…` |
| `sfx` | `sfx.shoot.laser`（值为变体数组，随机取一个） | `audio/sfx/…` |
| `bgm` | `bgm.explore` | `audio/bgm/…` |
| `font` | `font.pixel.cn`、`font.scifi.title` | `fonts/…` |

**每条 manifest 记录建议字段**：
```json
{
  "id": "tower.laser.t1",
  "src": "sprites/towers/tower-laser-t1-base.png",
  "turret": "sprites/towers/tower-laser-t1-turret.png",
  "size": [64, 64],
  "anchor": [0.5, 0.5],
  "source": "kenney/tower-defense-top-down",
  "license": "CC0-1.0",
  "url": "https://kenney.nl/assets/tower-defense-top-down"
}
```
`source` + `license` + `url` 三个字段务必保留 —— 这是**授权追溯台账**，将来若要出 `CREDITS`
或应对发行平台（Steam / App Store）的版权审查，可直接由 manifest 生成，不用回头翻素材包。

### 11.4 程序化占位与真实素材的协作约定

本项目要求「程序化图形占位 + 网络素材一起用，优先用合适的素材」，建议这样落地：

1. **manifest 是唯一真相源**。代码永远只按逻辑 ID 取图；取不到时**不要抛错**，而是回落到程序化生成器（例如 `tower.laser.t1` 缺失 → 画一个带旋转炮管的几何图形）。
2. **占位用几何/极简素材**：Kenney **Shape Characters**（§3.5）、**Simple Space**（§5.4）本身就是 CC0 且风格极简，天生适合当 fallback，可长期保留在包里，不必等正式美术到位就删。
3. **逐步替换**：先跑通玩法用占位色块 → 再换成 §2/§4 的正式 tile 与塔 → 最后用 §6 的 UI 收尾。每一步只改 `manifest.json`，不改游戏逻辑。
4. **网格基准先定死**：若走像素风就定 `TILE = 16`（配 §2.1 / §2.3 / §5.2），若走清晰风就定 `TILE = 64`（配 §4.1 / §4.2 / §3.1）。**两套网格不要混用**，否则 tile 接缝会错位。
5. **渲染开关**：像素素材务必开 `imageSmoothingEnabled = false`（nearest-neighbor），否则 16×16 tile 会被插值糊掉。

---

## 12. 附：一句话总览

| 类别 | 首选（CC0） | 体积 |
|---|---|---|
| 地形 tileset | Kenney **Tower Defense (Top-Down)** + **Roguelike/RPG pack**；题材最贴合：Buch **Colony Sim Extended** | 3.1 MB / 699 KB / 167 KB |
| 角色怪物 | Kenney **Top-down Shooter**（含行走动画）+ **Monster Builder Pack**（拼外星怪） | 2.5 MB / 1.2 MB |
| 塔 / 建筑 | Kenney **Tower Defense (Top-Down)** + **Sci-fi RTS** | 3.1 MB / 1.9 MB |
| 载具 | Kenney **Top-down Tanks Redux**（炮塔可分层）+ **Pixel Vehicle Pack** | 352 KB / 59 KB |
| 科幻 UI | Kenney **UI Pack: Sci-Fi** + **Minimap Pack**（开放世界必备） | 750 KB / 83 KB |
| 音效 | Kenney **Sci-Fi Sounds** + **Interface Sounds** + **Impact Sounds**；OGA **50 CC0 Sci-Fi SFX**（含 loop） | 5.6 MB / 815 KB / 782 KB / 2.3 MB |
| BGM | OGA **Space Music: Out There** + **Tower Defense Theme** + Sparklin Labs 四首 | 3.7 MB / 7.6 MB / 2.1 MB |
| 中文像素字体 | **Cubic 11**（2.6 MB 单文件，最省事）或 **Fusion Pixel Font**（字形最全） | 2.6 MB / 33 MB |
| 科幻拉丁字体 | Google Fonts **Orbitron** + **Oxanium** | 39 KB / 44 KB |

**上表「首选」全部下载合计约 36 MB**（若再砍掉 Fusion Pixel 的 33 MB 全量包、改用 Cubic 11 单文件，则核心素材仅约 **6 MB**）；
授权全部为 **CC0 1.0 或 OFL 1.1**，均可商用、可修改、**免署名**。
