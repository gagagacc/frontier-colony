# 开拓者：殖民地 · Godot 版

2D 俯视角外星殖民游戏：**塔防 + 开放世界探索 + 城镇经营**。
这是 Godot 4.4（GDScript）版本。

**下载来玩**：https://github.com/gagagacc/frontier-colony-godot/releases
解压后双击 `开拓者-殖民地.exe`。绿色版，不需要安装，也不需要装 Godot。

---

## 用 Godot 打开

本仓库的**根目录就是 Godot 工程**：

```bash
git clone https://github.com/gagagacc/frontier-colony-godot.git
```

用 **Godot 4.4.x** 打开这个目录，按 `F5` 运行。第一次打开会导入资源，需要几十秒。

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

## 自己导出 exe

```bash
node tools/godot-export.mjs      # 需要 Godot 4.4.x 与导出模板
```

## 验证

移植是按「与 JS 原版逐位一致」验收的：

```bash
node tools/godot-verify.mjs      # 跨语言黄金对比 + 120 秒长时模拟
```

## 项目结构

```
project.godot   工程文件
scripts/        游戏源码
  core/         数学 / 随机数 / 数据加载 / 按键表
  world/        世界生成 / 流场寻路 / 空间哈希 / 副本
  systems/      玩家 / 敌人 / 防御塔 / 波次 / 科技 / 城镇 / 存档
  render/       地形与单位绘制
  ui/           面板与 HUD
scenes/         场景
data/           数值表（由 HTML 原版的数据导出生成）
assets/         贴图与字体
tests/          断言与黄金值
tools/          验证与导出脚本
```

机制细节与移植过程见 [`PORT-PLAN.md`](PORT-PLAN.md)。

## 另一个版本

HTML / Canvas 原版是**独立的项目**：
https://github.com/gagagacc/frontier-colony
（[在线试玩](https://gagagacc.github.io/frontier-colony/)）

## 授权

第三方素材：Kenney 的三个包（**CC0**）与 Cubic 11 中文字体（**OFL-1.1**）。
