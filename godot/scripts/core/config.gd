## 全局常量 —— 与 `src/core/config.js` 对齐。
##
## 只放「世界生成与基础系统」需要的部分，其余随阶段推进补充。
class_name Cfg

# ---- 地形网格 ----
const TILE := 40                    # 单格像素
const CHUNK := 16                   # 每个地形缓存块 = 16x16 格
const WORLD_TILES := 304
const WORLD_PX := WORLD_TILES * TILE
const AREA := WORLD_TILES * WORLD_TILES
## 相对原 176 格世界的地图缩放（巢穴/地标数量都按它算）
const MAP_SCALE := float(WORLD_PX * WORLD_PX) / float(7040 * 7040)
const FLOW_CELL := 2                # 流场降采样：一个流场格 = 2x2 地块

# ---- 地块类型（数值 id 进存档，顺序不能改）----
const T_VOID := 0
const T_REGOLITH := 1
const T_GRASS := 2
const T_SAND := 3
const T_ASH := 4
const T_ROCK := 5
const T_MOUNTAIN := 6
const T_WATER := 7
const T_SHALLOW := 8
const T_CRYSTAL := 9
const T_FUNGUS := 10
const T_ICE := 11
const T_ROAD := 12
const T_CONCRETE := 13
const T_SCORCHED := 14
const T_SWAMP := 15
const T_NEST_WALL := 16
const T_NEST_FLOOR := 17
const T_NEST_ORGAN := 18

# ---- 生物群系 ----
const B_BASIN := 0
const B_VERDANT := 1
const B_DUNES := 2
const B_ASHLANDS := 3
const B_CRYSTALFIELD := 4
const B_SPOREFEN := 5
const B_GLACIER := 6
const B_HIGHLAND := 7
const B_SCAR := 8

## 实心地块（不可通行）—— 与 TILE_DEF.solid 一致
const SOLID_TILES := [0, 5, 6, 7, 16]

static func is_solid_tile(t: int) -> bool:
	return SOLID_TILES.has(t)


# ---- 降落点难度分级 ----
const LANDING_TIER := {
	1: { "name": "一级 · 安全区", "color": "#6ee7a8", "desc": "附近没有虫巢，地形温和。适合稳扎稳打铺开家底。" },
	2: { "name": "二级 · 边界区", "color": "#8fe0ff", "desc": "远处有虫巢活动。资源尚可，需要尽快把塔立起来。" },
	3: { "name": "三级 · 前沿区", "color": "#ffba4c", "desc": "虫巢就在附近。资源最丰厚，但落地就会有压力。" },
}

# ---- 命名表 ----
const NEST_NAMES := ["赤针", "蚀骨", "涌潮", "裂石", "灰瘴", "雷喙", "霜髓", "熔核", "暗孢", "锈爪", "虚鸣", "棘冠", "烛瞳", "渊喉"]
const RUIN_NAMES := ["希望号前哨", "铁砧三号", "远星观测站", "拓荒者营地", "曙光补给点", "沉默哨塔", "灰烬站", "猎户前哨"]
