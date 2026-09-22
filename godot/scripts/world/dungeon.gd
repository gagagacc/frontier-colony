## 虫巢副本的挖掘生成 —— `src/world/dungeon.js` 的移植。
##
## 布局是「鱼骨刺」：一条主通道从入口通到最深处的 Boss 房，两侧挂侧室。
## 挖法就是直接在**地块数组上挖洞**，洞外全填实心 —— 这样洞穴天然封闭，
## 而且完全复用现成的碰撞/寻路/渲染，不需要第二套地图表示。
##
## 两个玩家反馈定下来的点：
##   1. **外面也填巢壁，不留虚空**：虚空和巢壁都是近黑色，玩家分不清「墙」和「地板」；
##      而且地表 props 没清干净会画在虚空上（「虫巢里怎么和外面一个风格」）。
##   2. **入口单独挖一间大厅**：基地半径 96px 比 5 格走廊（200px）还宽，
##      直接把基地塞进走廊会把通道堵死、玩家一步也动不了。
class_name Dungeon

const T_NEST_WALL := Cfg.T_NEST_WALL
const T_NEST_FLOOR := Cfg.T_NEST_FLOOR
const T_NEST_ORGAN := Cfg.T_NEST_ORGAN
const B_SCAR := Cfg.B_SCAR


## 巢穴等级 1~10 对应的副本规模
static func plan_for(tier: int) -> Dictionary:
	var t := clampi(tier, 1, 10)
	return {
		"tier": t,
		"chambers": 2 + int(round(float(t - 1) * 0.45)),
		"length": 54 + t * 4,
		"corridorHalf": 2,
		"chamberHalf": 4,
		"wrecks": 1 + int(floor(float(t) / 3.0)),
		"bossScale": 1.0 + float(t - 1) * 0.28,
	}


## 把世界挖成一条虫巢通道。返回 { plan, entry, playerStart, boss, chambers }
static func carve(world: GdWorld, tier: int) -> Dictionary:
	var plan := plan_for(tier)
	var rng := Rng.new(world.seed + ":dungeon" + str(tier))
	var w := Cfg.WORLD_TILES
	var h := Cfg.WORLD_TILES

	var region_w := mini(w, 132)
	var region_h := mini(h, 92)
	var rx0 := int(floor(float(w - region_w) / 2.0))
	var ry0 := int(floor(float(h - region_h) / 2.0))

	# 1) 全图巢壁（不是虚空）→ 在里面挖洞；地表残留一律作废
	for i in Cfg.AREA:
		world.tiles[i] = T_NEST_WALL
		world.biomes[i] = B_SCAR
	world.no_props = true
	world.props.clear()
	world.nests.clear()
	world.pois.clear()
	world.modified_tiles.clear()
	world.chunks.clear()

	var mid_y := ry0 + int(floor(float(region_h) / 2.0))
	var start_x := rx0 + 6

	var dig := func(x: int, y: int) -> void:
		if x < 1 or y < 1 or x >= w - 1 or y >= h - 1:
			return
		if x < rx0 + 1 or y < ry0 + 1 or x >= rx0 + region_w - 1 or y >= ry0 + region_h - 1:
			return
		var i := y * w + x
		world.tiles[i] = T_NEST_FLOOR
		world.biomes[i] = B_SCAR

	var max_len := region_w - 30
	var end_x := mini(start_x + mini(int(plan["length"]), max_len), rx0 + region_w - 18)

	# 2) 入口大厅（13×9）：基地靠左、玩家站右侧，两者不重叠
	var hall_half_w := 6
	var hall_half_h := 4
	var hall_x := rx0 + 4
	for y in range(mid_y - hall_half_h, mid_y + hall_half_h + 1):
		for x in range(hall_x, hall_x + hall_half_w * 2 + 1):
			dig.call(x, y)
	for y in range(mid_y - 2, mid_y + 3):
		for x in range(hall_x + 1, hall_x + 5):
			var i := y * w + x
			if world.tiles[i] == T_NEST_FLOOR:
				world.tiles[i] = T_NEST_ORGAN

	# 3) 主通道
	var corridor_half := int(plan["corridorHalf"])
	for x in range(start_x, end_x + 1):
		for dy in range(-corridor_half, corridor_half + 1):
			dig.call(x, mid_y + dy)

	# 4) 侧室 + 支路（上下交替，像鱼骨）
	var chambers: Array = []
	var chamber_count := int(plan["chambers"])
	var chamber_half := int(plan["chamberHalf"])
	var max_up := maxi(chamber_half + 3, mid_y - (ry0 + 2))
	var max_down := maxi(chamber_half + 3, (ry0 + region_h - 3) - mid_y)
	for c in chamber_count:
		var px := start_x + int(round(float(end_x - start_x) * (float(c) + 0.7) / (float(chamber_count) + 0.4)))
		var up := c % 2 == 0
		var room := max_up if up else max_down
		var max_dist := maxi(chamber_half + 2, room - chamber_half - 1)
		var dist := mini(max_dist, chamber_half + 3 + rng.range_i(0, 3))
		var cy := mid_y + (-dist if up else dist)
		var cx := px + rng.range_i(-2, 2)

		# 支路
		var y := mid_y
		while (y >= cy) if up else (y <= cy):
			dig.call(px, y)
			dig.call(px + 1, y)
			y += -1 if up else 1
		# 侧室本体
		for yy in range(cy - chamber_half, cy + chamber_half + 1):
			for xx in range(cx - chamber_half, cx + chamber_half + 1):
				dig.call(xx, yy)
		chambers.append({
			"tx": cx, "ty": cy,
			"x": float(cx * Cfg.TILE) + Cfg.TILE / 2.0,
			"y": float(cy * Cfg.TILE) + Cfg.TILE / 2.0,
		})

	# 5) Boss 房（按等级放大：15×15 / 19×19 / 23×23）
	var tier_i := int(plan["tier"])
	var boss_half := mini(15 if tier_i >= 8 else (12 if tier_i >= 4 else 10),
		int(floor(float(region_h - 6) / 2.0)))
	var boss_tx := mini(end_x + boss_half + 2, rx0 + region_w - boss_half - 2)
	for y in range(mid_y - boss_half, mid_y + boss_half + 1):
		for x in range(end_x, boss_tx + boss_half + 1):
			dig.call(x, y)
	for y in range(mid_y - 2, mid_y + 3):
		for x in range(boss_tx - 3, boss_tx + 4):
			var i2 := y * w + x
			if world.tiles[i2] == T_NEST_FLOOR:
				world.tiles[i2] = T_NEST_ORGAN
	# 四角支撑柱（大房间空荡荡看着假，柱子也给走位参照）
	var pillar_offs: Array[Vector2i] = [Vector2i(-1, -1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(1, 1)]
	for off in pillar_offs:
		var cx2: int = boss_tx + off.x * (boss_half - 3)
		var cy2: int = mid_y + off.y * (boss_half - 3)
		for yy in range(cy2 - 1, cy2 + 2):
			for xx in range(cx2 - 1, cx2 + 2):
				var i3 := yy * w + xx
				if i3 >= 0 and i3 < world.tiles.size():
					world.tiles[i3] = T_NEST_WALL
	var boss := {
		"tx": boss_tx, "ty": mid_y,
		"x": float(boss_tx * Cfg.TILE) + Cfg.TILE / 2.0,
		"y": float(mid_y * Cfg.TILE) + Cfg.TILE / 2.0,
	}

	# 6) 入口与玩家出生点
	var base_tx := hall_x + 2
	var entry := {
		"tx": base_tx, "ty": mid_y,
		"x": float(base_tx * Cfg.TILE) + Cfg.TILE / 2.0,
		"y": float(mid_y * Cfg.TILE) + Cfg.TILE / 2.0,
	}
	var player_tx := hall_x + hall_half_w * 2 - 2
	var player_start := {
		"tx": player_tx, "ty": mid_y,
		"x": float(player_tx * Cfg.TILE) + Cfg.TILE / 2.0,
		"y": float(mid_y * Cfg.TILE) + Cfg.TILE / 2.0,
	}

	var region := { "x0": rx0, "y0": ry0, "w": region_w, "h": region_h }
	world.dungeon = {
		"tier": tier_i, "plan": plan, "entry": entry, "playerStart": player_start,
		"boss": boss, "chambers": chambers, "cleared": false, "region": region,
	}
	world.tile_revision += 1
	return { "plan": plan, "entry": entry, "playerStart": player_start, "boss": boss, "chambers": chambers }
