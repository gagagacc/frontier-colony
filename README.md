# 开拓者：殖民地

2D 俯视角外星殖民游戏：**塔防 + 开放世界探索 + 城镇经营**。

你是被派到陌生星球的开荒者。吸引阵列会把虫巢的怪引过来 —— 那是你的金币和经验，也是你的死因。

**在线试玩**：https://gagagacc.github.io/frontier-colony/

---

## 运行

```bash
npm install
npm start          # 桌面版（Electron）
npm run dev        # 浏览器版，改代码后刷新即可
```

## 打包

```bash
npm run dist:dir                            # 生成正式构建 → dist/win-unpacked
node tools/make-portable.mjs --zip          # 打成绿色版 zip
```

## 操作

| 移动 | `WASD` / 方向键 | 冲刺 | `Shift` |
|---|---|---|---|
| 闪避 | `Space` | 采集 / 维修 | `E`（按住） |
| 上车 · 进虫巢 · 交互遗迹 | `F` | 换弹 | `R` |
| 切武器 | `Q` / `1`-`8` | 接管炮塔 | `C` |
| 建造 | `B` | 科技 | `T` |
| 城镇 | `G` | 实验科技 | `V` |
| 背包 | `Tab` | 地图 | `M` |
| 暂停 / 面板 | `Esc` | 快存 / 快读 | `F5` / `F9` |

手柄插上即用（Xbox 布局）。

## 验证

```bash
node tools/verify.mjs        # 逻辑、输入、数据表、模块导入
node tools/verify.mjs --all  # 再带上浏览器端与核心循环（需要 Electron）
```

## 项目结构

```
index.html      入口
src/            游戏源码
  core/         噪声 / 随机数 / 输入 / 设置 / 配置
  world/        世界生成 / 流场寻路 / 空间哈希 / 副本
  systems/      玩家 / 敌人 / 防御塔 / 波次 / 科技 / 城镇 / 存档
  render/       Canvas 渲染
  ui/           面板与 HUD
  data/         数值表
electron/       桌面壳
tools/          构建与验证脚本
docs/           开发笔记
```

机制细节与设计取舍见 [`docs/开发笔记.md`](docs/开发笔记.md)。

## 另一个版本

Godot 4.4（GDScript）移植版是**独立的项目**：
https://github.com/gagagacc/frontier-colony-godot

## 授权

第三方素材：Kenney 的三个包（**CC0**）与 Cubic 11 中文字体（**OFL-1.1**）。
