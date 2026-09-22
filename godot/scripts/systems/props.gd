## 可采集物（props）与采集 —— `world._spawnChunk/_pickPropType/_makeProp` + `player.updateHarvest` 的移植。
##
## 地表资源是**按区块惰性生成**的：同一个区块永远长同样的东西（可复现），
## 而且只生成玩家附近的区块，所以整张地图不需要一次铺满。
##
## 采集规则（玩家反馈打磨出来的）：
##   - 按住 E 持续采集，基地废墟优先于一切（否则站在废墟旁会去采旁边的灌木）；
##   - 每秒伤害 26 ×(1+采集速度)，**工具匹配 ×1.8、不匹配 ×0.55**
##     （钝器=镐、刃=斧，见武器 subtype）；
##   - 产出**按小块跳**（每 0.6 秒结算一次），每块都跳出 +N 飘字；
##   - 采完按 PROP_DEF.respawn 决定重生秒数（植物会重生、矿脉不会）。
class_name Props

const HARVEST_RANGE := 78.0
const BASE_DPS := 26.0
const CHIP_INTERVAL := 0.6
const TOOL_MATCH_MULT := 1.8
const TOOL_MISS_MULT := 0.55

var world: GdWorld
var props: Dictionary = {}         # id -> prop
var chunks: Dictionary = {}        # "cx,cy" -> { props: [id], spawned: true }
var harvested: Dictionary = {}     # id -> { t, type, x, y } 或 null（永久消失）
var seq := 1

var _prop_defs: Dictionary = {}
var _biome_monsters: Dictionary = {}


## ⚠️ 数据表只读一次并缓存：_biome_richness() 是**每个候选地块都会调**的，
## 里面再 DataLoader.new().table(...) 就等于每次重新解析一遍 JSON ——
## 走路时不断触发新区块生成，卡顿主要来自这里。
var _biome_table: Dictionary = {}


func setup(p_world: GdWorld) -> void:
	world = p_world
	_prop_defs = DataLoader.new().table("tiles", "PROP_DEF", {})
	_biome_table = DataLoader.new().table("tiles", "BIOME_DEF", {})


func _biome_defs() -> Dictionary:
	if _biome_table.is_empty():
		_biome_table = DataLoader.new().table("tiles", "BIOME_DEF", {})
	return _biome_table


func def_of(type: String) -> Dictionary:
	return _prop_defs.get(type, {})


## 惰性生成某个区块的障碍物 —— 与 JS `_spawnChunk` 同序（随机数消耗顺序也一样）
func spawn_chunk(ccx: int, ccy: int) -> void:
	var key := "%d,%d" % [ccx, ccy]
	if chunks.has(key):
		return
	chunks[key] = { "props": [] }
	if world.no_props:
		return
	var rng := Rng.new("%s:chunk:%d:%d" % [world.seed, ccx, ccy])
	var dens := GdNoise.ValueNoise.new(world.seed + ":dens")
	var clus := GdNoise.CellNoise.new(world.seed + ":clus", 7.0)
	var chunk: Dictionary = chunks[key]

	var ly := 0
	while ly < Cfg.CHUNK:
		var lx := 0
		while lx < Cfg.CHUNK:
			var tx := ccx * Cfg.CHUNK + lx + rng.range_i(0, 1)
			var ty := ccy * Cfg.CHUNK + ly + rng.range_i(0, 1)
			lx += 2
			if tx < 2 or ty < 2 or tx >= Cfg.WORLD_TILES - 2 or ty >= Cfg.WORLD_TILES - 2:
				continue
			var idx := ty * Cfg.WORLD_TILES + tx
			if Cfg.is_solid_tile(world.tiles[idx]) or world.blocked[idx] != 0:
				continue
			# 基地范围里不长东西；巢穴正中心留空
			if world.base_site != null and GdMath.dist(float(tx * Cfg.TILE), float(ty * Cfg.TILE),
				float(world.base_site["x"]), float(world.base_site["y"])) < 560.0:
				continue
			if _nest_near(float(tx * Cfg.TILE), float(ty * Cfg.TILE), 130.0) > 0:
				continue
			var biome := world.biomes[idx]
			var richness := _biome_richness(biome)
			var density := GdMath.clampf01(richness * 0.30 * (0.45 + dens.fbm(float(tx) * 0.06, float(ty) * 0.06, 3)))
			var cl: Array = clus.at(float(tx), float(ty))
			var cluster_boost := 1.9 if float(cl[0]) < 0.30 else 1.0
			if rng.next_f() > density * cluster_boost:
				continue
			var type := pick_prop_type(biome, world.tiles[idx], rng)
			if type == "":
				continue
			var prop := make_prop(type,
				float(tx * Cfg.TILE) + Cfg.TILE / 2.0 + rng.range_f(-9.0, 9.0),
				float(ty * Cfg.TILE) + Cfg.TILE / 2.0 + rng.range_f(-9.0, 9.0), rng)
			if prop.is_empty():
				continue
			prop["chunk"] = key
			props[prop["id"]] = prop
			(chunk["props"] as Array).append(prop["id"])
		ly += 2



func _biome_richness(biome: int) -> float:
	var defs: Dictionary = _biome_defs()
	var d = defs.get(str(biome), defs.get(biome, null))
	if d is Dictionary:
		return DataLoader.num_or(d, "richness", 1.0)
	return 1.0


func _nest_near(x: float, y: float, radius: float) -> int:
	var n := 0
	for nest in world.nests:
		if GdMath.truthy(nest.get("destroyed", false)):
			continue
		if GdMath.dist(x, y, float(nest["x"]), float(nest["y"])) <= radius:
			n += 1
	return n


## 选障碍物类型 —— 与 JS `_pickPropType` 完全同序（含 3 次稀有度掷骰）
func pick_prop_type(biome: int, tile: int, rng: Rng) -> String:
	var rare_roll := rng.next_f()
	var uniq_roll := rng.next_f()
	var special_roll := rng.next_f()

	var pool: Array = []
	for key in _prop_defs.keys():
		var def: Dictionary = _prop_defs[key]
		if key == "cache" or key == "dataObelisk" or key == "eggSac" or key == "wreckCache":
			continue
		if def.has("biome") and def["biome"] != null:
			# ⚠️ 必须**逐项转 int 比**：JSON 里所有数字都是 float，
			# 而 GDScript 的 Array.has(1) 在数组是 [1.0, 0.0, 5.0] 时返回 false ——
			# 结果是「所有带 biome 限制的道具全被跳过」，池子里只剩兜底的残骸。
			var biomes: Array = def["biome"]
			var has_biome := false
			for b in biomes:
				if int(b) == biome:
					has_biome = true
					break
			if not has_biome:
				continue
		var w := 1.0
		var tool = def.get("tool", null)
		if tool == "pick" and (tile == Cfg.T_ROCK or tile == Cfg.T_CRYSTAL or tile == Cfg.T_ASH):
			w = 2.4
		if tool == null and (tile == Cfg.T_GRASS or tile == Cfg.T_FUNGUS):
			w = 1.8
		pool.append([String(key), w])
	if biome == Cfg.B_SCAR or biome == Cfg.B_ASHLANDS:
		pool.append(["eggSac", 0.9])
	if pool.is_empty():
		pool.append(["wreck", 1.0])

	var picked: Variant = rng.weighted(pool)
	if uniq_roll < 0.004:
		return "dataObelisk"
	if rare_roll < 0.018:
		return "cache"
	var key2 := String(picked)
	# 残骸类里有一半其实是「金属堆」（被拆空的那种）
	if (key2 == "wreck" or key2 == "wreckCache") and special_roll < 0.5:
		return "metalHeap"
	return key2


## 建一个可采集物（与 JS `_makeProp` 同序：variant 然后 scale）
func make_prop(type: String, x: float, y: float, rng: Rng) -> Dictionary:
	var def := def_of(type)
	if def.is_empty():
		return {}
	var id := "p%d" % seq
	seq += 1
	return {
		"id": id, "type": type, "x": x, "y": y,
		"r": DataLoader.num_or(def, "r", 14.0),
		"hp": DataLoader.num_or(def, "hp", 20.0),
		"maxHp": DataLoader.num_or(def, "hp", 20.0),
		"shake": 0.0, "hitFlash": 0.0,
		"variant": rng.next_f(),
		"scale": rng.range_f(0.88, 1.14),
		"dead": false,
		"chunk": "%d,%d" % [int(floor(x / float(Cfg.CHUNK * Cfg.TILE))),
			int(floor(y / float(Cfg.CHUNK * Cfg.TILE)))],
	}


## 还缺哪些区块（按离玩家近的优先）——给 FrameBudget 分帧生成用
func missing_chunks(x: float, y: float, radius_px: float) -> Array:
	var out: Array = []
	var c0x := int(floor((x - radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var c1x := int(floor((x + radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var c0y := int(floor((y - radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var c1y := int(floor((y + radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var max_c := int(ceil(float(Cfg.WORLD_TILES) / float(Cfg.CHUNK))) - 1
	var ccx := int(floor(x / float(Cfg.CHUNK * Cfg.TILE)))
	var ccy := int(floor(y / float(Cfg.CHUNK * Cfg.TILE)))
	for cy in range(maxi(0, c0y), mini(max_c, c1y) + 1):
		for cx in range(maxi(0, c0x), mini(max_c, c1x) + 1):
			if not chunks.has("%d,%d" % [cx, cy]):
				out.append(Vector2i(cx, cy))
	# 近的排前面：走路时先把脚下的区块补上，远处的慢慢来
	out.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		var da := absi(a.x - ccx) + absi(a.y - ccy)
		var db := absi(b.x - ccx) + absi(b.y - ccy)
		return da < db)
	return out


## 玩家附近的区块按需生成（一次全做完；**新代码请用 missing_chunks + FrameBudget**）
func ensure_around(x: float, y: float, radius_px: float) -> int:
	var c0x := int(floor((x - radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var c1x := int(floor((x + radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var c0y := int(floor((y - radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var c1y := int(floor((y + radius_px) / float(Cfg.CHUNK * Cfg.TILE)))
	var n := 0
	var max_c := int(ceil(float(Cfg.WORLD_TILES) / float(Cfg.CHUNK))) - 1
	for cy in range(maxi(0, c0y), mini(max_c, c1y) + 1):
		for cx in range(maxi(0, c0x), mini(max_c, c1x) + 1):
			var before := props.size()
			spawn_chunk(cx, cy)
			if props.size() > before:
				n += 1
	return n


## 找一个最近的、在范围内的可采集物
func nearest(x: float, y: float, range_px: float = HARVEST_RANGE) -> Variant:
	var best: Variant = null
	var best_d := range_px * range_px
	for id in props.keys():
		var p: Dictionary = props[id]
		if GdMath.truthy(p.get("dead", false)):
			continue
		var d := GdMath.dist2(x, y, float(p["x"]), float(p["y"]))
		if d < best_d:
			best_d = d
			best = p
	return best


## 每帧采集：返回 { ok, prop, dps, complete, chips }
func harvest_tick(prop: Dictionary, dt: float, stats: StatSet, tool_tag: String) -> Dictionary:
	var def := def_of(String(prop["type"]))
	var dps := BASE_DPS * (1.0 + stats.stat("mineSpeed"))
	var want := String(def.get("tool", "")) if def.get("tool", null) != null else ""
	if want != "":
		dps *= TOOL_MATCH_MULT if tool_tag == want else TOOL_MISS_MULT
	prop["hp"] = float(prop["hp"]) - dps * dt
	prop["shake"] = 1.0
	prop["hitFlash"] = 1.0
	return {
		"ok": true, "prop": prop, "dps": dps,
		"progress": 1.0 - GdMath.clampf01(float(prop["hp"]) / maxf(1.0, float(prop["maxHp"]))),
		"complete": float(prop["hp"]) <= 0.0,
	}


## 采完结算：给出整份产出，并按 respawn 决定重生安排
func harvest_complete(prop: Dictionary) -> Dictionary:
	var def := def_of(String(prop["type"]))
	var out: Dictionary = {}
	var yields: Dictionary = def.get("yield", {})
	for k in yields.keys():
		var pair: Array = yields[k]
		var lo := float(pair[0])
		var hi := float(pair[1])
		if hi <= 0.0:
			continue
		out[String(k)] = randi_range(int(lo), int(hi))
	prop["dead"] = true
	props.erase(prop["id"])
	var respawn := DataLoader.num_or(def, "respawn", 0.0)
	harvested[prop["id"]] = null if respawn <= 0.0 else {
		"t": respawn, "type": String(prop["type"]), "x": float(prop["x"]), "y": float(prop["y"]),
	}
	return out


## 把整份产出拆成若干小块（JS 的 _payoutChips：按总量决定分几块）
static func estimate_yield(def: Dictionary) -> float:
	var total := 0.0
	var yields: Dictionary = def.get("yield", {})
	for k in yields.keys():
		var pair: Array = yields[k]
		total += (float(pair[0]) + float(pair[1])) / 2.0
	return total


static func chips_for(def: Dictionary) -> int:
	# 平均产出越大，分块越多（每块大约 4 点资源），至少 2 块
	return maxi(2, int(round(estimate_yield(def) / 4.0)))
