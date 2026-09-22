## 世界生成 —— `src/world/world.js` 的移植（阶段 2）。
##
## 硬要求：**同一种子必须生成同一张地图**。做法是完全照搬 JS 的
## 调用顺序与随机数消耗顺序，逐阶段验证（黄金对比里 `world` 用例
## 会在每个阶段后取一次哈希，一旦不一致能立刻定位到是哪一步跑偏）。
##
## 阶段 2 只做「地形 + 群系 + 主连通区 + 降落点 + 巢穴 + 地标 + 起始区 + 焦土」，
## 障碍物/区块惰性生成留到阶段 3（它不影响 tiles 哈希）。
class_name GdWorld

const W := Cfg.WORLD_TILES
const AREA := Cfg.AREA

## 每个世界一个自增 id —— 与 JS 版同样的理由：渲染/小地图的缓存必须区分
## 「这是哪一张地图」，否则进虫巢副本时会继续画地表那张底图。
static var _seq := 0
var uid := 0

var seed: String
var planet_index: int
var planet_name: String
var mode: String
var nest_scale: float
var poi_scale: float

var rng: Rng
var tiles: PackedByteArray
var biomes: PackedByteArray
var variant: PackedByteArray
var blocked: PackedByteArray

var pois: Array = []
var nests: Array = []
var base_site = null
var landing_sites: Array = []
var main_region := 0
## 副本信息（进副本时由 Dungeon.carve 写入）：{ tier, plan, entry, boss, chambers, region }
var dungeon = null
## 副本里不按生物群系撒地表障碍物（见 dungeon.carve）
var no_props := false
## 惰性区块与障碍物（副本只用得到 modified_tiles / chunks 的清理接口）
var props: Dictionary = {}
var chunks: Dictionary = {}

## 分阶段哈希（诊断用：黄金对比失败时能直接看出哪一步跑偏）
var stage_hashes: Dictionary = {}


func _init(p_seed = "frontier", opts: Dictionary = {}) -> void:
	_seq += 1
	uid = _seq
	seed = str(p_seed)
	planet_index = int(opts.get("planetIndex", 0))
	planet_name = str(opts.get("name", "开普勒-442b"))
	mode = str(opts.get("mode", "frontier"))
	nest_scale = float(opts.get("nestScale", 1.0))
	poi_scale = float(opts.get("poiScale", 1.0))

	rng = Rng.new(seed + ":world")
	tiles = PackedByteArray()
	tiles.resize(AREA)
	biomes = PackedByteArray()
	biomes.resize(AREA)
	variant = PackedByteArray()
	variant.resize(AREA)
	blocked = PackedByteArray()
	blocked.resize(AREA)

	generate()


func generate() -> void:
	var n_elev := GdNoise.ValueNoise.new(seed + ":elev")
	var n_ridge := GdNoise.ValueNoise.new(seed + ":ridge")
	var n_moist := GdNoise.ValueNoise.new(seed + ":moist")
	var n_temp := GdNoise.ValueNoise.new(seed + ":temp")
	var n_cryst := GdNoise.ValueNoise.new(seed + ":cryst")
	var n_detail := GdNoise.ValueNoise.new(seed + ":detail")
	var n_scar := GdNoise.CellNoise.new(seed + ":scarfield", 26.0)

	var p := planet_index
	var temp_bias := GdMath.clampv(float(p) * 0.09, 0.0, 0.4)
	var moist_bias := -GdMath.clampv(float(p) * 0.05, 0.0, 0.25)
	var crystal_bias := GdMath.clampv(float(p) * 0.05, 0.0, 0.28)

	var cx := float(W) / 2.0
	var cy := float(W) / 2.0
	var max_r := float(W) * 0.52
	var scale := 0.021

	for y in W:
		for x in W:
			var idx := y * W + x
			var dx := (float(x) - cx) / max_r
			var dy := (float(y) - cy) / max_r
			var radial := sqrt(dx * dx + dy * dy)
			var falloff := GdMath.clampf01(1.0 - pow(radial, 2.6))

			var fx := float(x)
			var fy := float(y)
			var e := n_elev.fbm(fx * scale, fy * scale, 5) * 0.72 + 0.28 * (1.0 - radial)
			var elev := GdMath.clampf01(e * 0.72 + falloff * 0.34)
			var ridge := n_ridge.ridged(fx * scale * 1.7 + 40.0, fy * scale * 1.7 - 25.0, 4)
			var moist := GdMath.clampf01(n_moist.warped(fx * scale * 1.25 + 3.0, fy * scale * 1.25 - 7.0, 0.5, 4) + moist_bias)
			var temp := GdMath.clampf01(n_temp.fbm(fx * scale * 0.9 - 11.0, fy * scale * 0.9 + 19.0, 3) + temp_bias)
			var cryst := n_cryst.fbm(fx * scale * 2.2 + 61.0, fy * scale * 2.2 + 7.0, 2) + crystal_bias

			var t := 0
			if elev < 0.245:
				t = Cfg.T_VOID
			elif elev < 0.30:
				t = Cfg.T_WATER
			elif elev < 0.335:
				t = Cfg.T_SHALLOW
			elif elev > 0.815 or (ridge > 0.80 and elev > 0.70):
				t = Cfg.T_MOUNTAIN
			elif ridge > 0.665 and elev > 0.585:
				t = Cfg.T_ROCK
			else:
				var b := 0
				if cryst > 1.02:
					b = Cfg.B_CRYSTALFIELD
				elif temp < 0.315:
					b = Cfg.B_GLACIER
				elif temp > 0.70 and moist < 0.42:
					b = Cfg.B_ASHLANDS if ridge > 0.55 else Cfg.B_DUNES
				elif moist > 0.655:
					b = Cfg.B_SPOREFEN
				elif moist > 0.50:
					b = Cfg.B_VERDANT
				elif ridge > 0.58 or elev > 0.66:
					b = Cfg.B_HIGHLAND
				else:
					b = Cfg.B_BASIN

				var ground: Array = _biome_ground(b)
				var pick := n_detail.at(fx * 0.11 + 5.0, fy * 0.11 - 3.0)
				var gi := int(floor(pick * float(ground.size())))
				t = int(ground[mini(ground.size() - 1, gi)])
				biomes[idx] = b

			tiles[idx] = t
			variant[idx] = int(floor(n_detail.at(fx * 0.37, fy * 0.37) * 255.0))

	_hash_stage("afterLoop")
	_classify_biomes()
	_hash_stage("afterClassify")
	_flood_fill_main_region()
	_hash_stage("afterFlood")
	_place_landing_sites()
	_hash_stage("afterLanding")
	_place_nests(n_scar, rng)
	_hash_stage("afterNests")
	_place_major_pois(rng)
	_hash_stage("afterPois")
	_carve_starter_zone(rng)
	_hash_stage("afterStarter")
	_apply_scars()
	_hash_stage("afterScars")


## 群系地表材质表（ground: [tile, tile, ...]）—— 从 tiles.json 读，与 JS 同源
var _biome_ground_cache: Dictionary = {}

func _biome_ground(b: int) -> Array:
	if _biome_ground_cache.has(b):
		return _biome_ground_cache[b]
	var defs: Dictionary = _data().table("tiles", "BIOME_DEF", {})
	var ground: Array = [Cfg.T_REGOLITH]
	var d = defs.get(str(b), defs.get(b, null))
	if d is Dictionary and d.has("ground"):
		ground = d["ground"]
	_biome_ground_cache[b] = ground
	return ground


func _biome_def(b: int) -> Dictionary:
	var defs: Dictionary = _data().table("tiles", "BIOME_DEF", {})
	var d = defs.get(str(b), defs.get(b, null))
	return d if d is Dictionary else {}


var _data_loader: DataLoader = null

func _data() -> DataLoader:
	if _data_loader == null:
		_data_loader = DataLoader.new()
	return _data_loader


## 把非地面地块也归入邻近生物群系
func _classify_biomes() -> void:
	for y in W:
		for x in W:
			var idx := y * W + x
			if biomes[idx] != 0:
				continue
			var found := 0
			for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
				var nx: int = x + d[0]
				var ny: int = y + d[1]
				if nx < 0 or ny < 0 or nx >= W or ny >= W:
					continue
				var b := biomes[ny * W + nx]
				if b != 0:
					found = b
					break
			biomes[idx] = found if found != 0 else Cfg.B_HIGHLAND


## 洪水填充找最大连通区，零散小岛填成裸岩
func _flood_fill_main_region() -> void:
	var label := PackedInt32Array()
	label.resize(AREA)
	label.fill(-1)
	var sizes: Array = []
	var queue := PackedInt32Array()
	queue.resize(AREA)
	var region := 0

	for i in AREA:
		if label[i] != -1 or Cfg.is_solid_tile(tiles[i]):
			continue
		var head := 0
		var tail := 0
		queue[tail] = i
		tail += 1
		label[i] = region
		var count := 0
		while head < tail:
			var cur := queue[head]
			head += 1
			count += 1
			var x := cur % W
			var y := (cur - x) / W
			for n in 4:
				var nx := x + (1 if n == 0 else (-1 if n == 1 else 0))
				var ny := y + (1 if n == 2 else (-1 if n == 3 else 0))
				if nx < 0 or ny < 0 or nx >= W or ny >= W:
					continue
				var ni := ny * W + nx
				if label[ni] != -1 or Cfg.is_solid_tile(tiles[ni]):
					continue
				label[ni] = region
				queue[tail] = ni
				tail += 1
		sizes.append(count)
		region += 1

	if sizes.is_empty():
		return
	var best := 0
	for i in range(1, sizes.size()):
		if sizes[i] > sizes[best]:
			best = i
	for i in AREA:
		if label[i] != -1 and label[i] != best:
			tiles[i] = Cfg.T_ROCK
	main_region = best


# =========================================================
#  降落点
# =========================================================

func _place_landing_sites() -> void:
	var candidates: Array = []
	var rng_l := Rng.new(seed + ":landing")
	var cx := float(W) / 2.0
	var cy := float(W) / 2.0

	if mode == "towerDefense":
		var tx := int(floor(cx))
		var ty := int(floor(cy))
		var px := float(tx * Cfg.TILE) + Cfg.TILE / 2.0
		var py := float(ty * Cfg.TILE) + Cfg.TILE / 2.0
		var b := biomes[ty * W + tx]
		var def := _biome_def(b)
		var tier1: Dictionary = Cfg.LANDING_TIER[1]
		landing_sites = [{
			"tx": tx, "ty": ty, "x": px, "y": py,
			"biome": b, "biomeName": def.get("name", ""),
			"hazard": def.get("hazard", 1.0), "richness": def.get("richness", 1.0),
			"variety": _biome_variety_around(tx, ty),
			"openSpace": _open_ratio_around(tx, ty),
			"nestNear": 0, "nestFar": 0, "danger": 0.0,
			"tier": 1, "tierName": tier1["name"],
			"tierDesc": "纯塔防阵地：所有怪潮都冲着这里来。",
			"tierColor": tier1["color"],
		}]
		return

	var attempt := 0
	var idx_seq := 0
	while attempt < 1200 and candidates.size() < 48:
		attempt += 1
		var a := rng_l.next_f() * PI * 2.0
		var r := rng_l.range_f(0.12, 0.62)
		var tx := int(floor(cx + cos(a) * r * float(W)))
		var ty := int(floor(cy + sin(a) * r * float(W)))
		if tx < 8 or ty < 8 or tx >= W - 8 or ty >= W - 8:
			continue
		if not _is_clear_box(tx, ty, 3):
			continue
		if _nest_count_near(float(tx * Cfg.TILE), float(ty * Cfg.TILE), 0.0) > 0:
			continue

		var b := biomes[ty * W + tx]
		var def := _biome_def(b)
		var px := float(tx * Cfg.TILE) + Cfg.TILE / 2.0
		var py := float(ty * Cfg.TILE) + Cfg.TILE / 2.0
		var near := _nest_threat_near(px, py, float(Cfg.TILE * 38))
		var far := _nest_threat_near(px, py, float(Cfg.TILE * 75)) - near
		var hazard := float(def.get("hazard", 1.0))
		var danger := near * 1.0 + far * 0.25 + hazard * 0.6

		candidates.append({
			"tx": tx, "ty": ty, "x": px, "y": py,
			"biome": b, "biomeName": def.get("name", ""),
			"hazard": hazard, "richness": float(def.get("richness", 1.0)),
			"variety": _biome_variety_around(tx, ty),
			"openSpace": _open_ratio_around(tx, ty),
			"nestNear": _nest_count_near(px, py, float(Cfg.TILE * 38)),
			"nestFar": _nest_count_near(px, py, float(Cfg.TILE * 75)) - _nest_count_near(px, py, float(Cfg.TILE * 38)),
			"danger": danger,
			"_idx": idx_seq,          # 稳定排序用（见下）
		})
		idx_seq += 1

	if candidates.is_empty():
		landing_sites = []
		return

	# 按危险度排序 —— **必须和 JS 一样是稳定排序**。
	#
	# JS 的 Array.prototype.sort 从 ES2019 起保证稳定；GDScript 的 sort_custom
	# 不稳定。而这里大量候选点的 danger 完全相同（附近没巢穴时 danger 只由
	# hazard 决定，全图就三个取值），不稳定排序会让「取前 4 个」的结果完全不同 ——
	# 实测表现就是降落点坐标对不上、基地被铺到另一个地方。
	# 做法：把插入顺序当第二关键字，等价于稳定排序。
	var cmp := func(a, b):
		if a["danger"] == b["danger"]:
			return int(a["_idx"]) < int(b["_idx"])
		return a["danger"] < b["danger"]
	candidates.sort_custom(cmp)
	var picked: Array = []
	for c in candidates:
		if picked.size() >= 4:
			break
		var ok := true
		for p in picked:
			if GdMath.dist(c["x"], c["y"], p["x"], p["y"]) < float(Cfg.WORLD_PX) * 0.22:
				ok = false
				break
		if ok:
			picked.append(c)
	var rest := candidates.duplicate()
	while picked.size() < 4 and not rest.is_empty():
		var c = rest.pop_front()
		if not picked.has(c):
			picked.append(c)

	picked.sort_custom(cmp)
	for i in picked.size():
		var c: Dictionary = picked[i]
		var tier := 1 if i == 0 else (2 if i == 1 else 3)
		var tdef: Dictionary = Cfg.LANDING_TIER[tier]
		c["tier"] = tier
		c["tierName"] = tdef["name"]
		c["tierDesc"] = tdef["desc"]
		c["tierColor"] = tdef["color"]
	landing_sites = picked


func _nest_threat_near(x: float, y: float, radius: float) -> float:
	var sum := 0.0
	for nest in nests:
		if nest.get("destroyed", false):
			continue
		if GdMath.dist(x, y, nest["x"], nest["y"]) <= radius:
			sum += float(nest["threat"])
	return sum


func _is_clear_box(tx: int, ty: int, rad: int) -> bool:
	for y in range(ty - rad, ty + rad + 1):
		for x in range(tx - rad, tx + rad + 1):
			if x < 0 or y < 0 or x >= W or y >= W:
				return false
			if Cfg.is_solid_tile(tiles[y * W + x]):
				return false
	return true


func _open_ratio_around(tx: int, ty: int) -> float:
	var open := 0
	var total := 0
	var r := 14
	var y := ty - r
	while y <= ty + r:
		var x := tx - r
		while x <= tx + r:
			if not (x < 0 or y < 0 or x >= W or y >= W):
				total += 1
				if not Cfg.is_solid_tile(tiles[y * W + x]):
					open += 1
			x += 2
		y += 2
	return float(open) / float(total) if total else 0.0


func _biome_variety_around(tx: int, ty: int) -> float:
	var seen := {}
	var r := 16
	var y := ty - r
	while y <= ty + r:
		var x := tx - r
		while x <= tx + r:
			if not (x < 0 or y < 0 or x >= W or y >= W):
				seen[biomes[y * W + x]] = true
			x += 3
		y += 3
	return GdMath.clampf01(float(seen.size() - 1) / 4.0)


# =========================================================
#  巢穴 / 地标
# =========================================================

func _place_nests(scar_field: GdNoise.CellNoise, r: Rng) -> void:
	var p := planet_index
	if mode == "towerDefense":
		nests = []
		return
	var target := int(round((11.0 + float(p) * 4.0 + float(r.range_i(0, 3))) * Cfg.MAP_SCALE * nest_scale))
	var min_gap := float(Cfg.TILE * (21 if p == 0 else 18))
	var placed: Array = []
	var guard := 0

	while placed.size() < target and guard < 20000:
		guard += 1
		var x := r.range_f(float(Cfg.TILE * 6), float(Cfg.WORLD_PX - Cfg.TILE * 6))
		var y := r.range_f(float(Cfg.TILE * 6), float(Cfg.WORLD_PX - Cfg.TILE * 6))
		var tx := int(floor(x / Cfg.TILE))
		var ty := int(floor(y / Cfg.TILE))
		if Cfg.is_solid_tile(tiles[ty * W + tx]):
			continue
		if not _is_clear_box(tx, ty, 2):
			continue
		var too_close := false
		for q in placed:
			if GdMath.dist(x, y, q["x"], q["y"]) < min_gap:
				too_close = true
				break
		if too_close:
			continue
		var b := biomes[ty * W + tx]
		var def := _biome_def(b)
		if r.next_f() > GdMath.clampf01(float(def.get("nestChance", 1.0)) / 2.2):
			continue
		placed.append({ "x": x, "y": y, "tx": tx, "ty": ty, "biome": b, "hazard": float(def.get("hazard", 1.0)) })

	for i in placed.size():
		var q: Dictionary = placed[i]
		var tier := _nest_tier_for(q)
		var hp := int(round((900.0 + float(tier) * 420.0) * (1.0 + float(p) * 0.45)))
		nests.append({
			"id": "nest_%d" % i,
			"x": q["x"], "y": q["y"], "r": 44.0,
			"tier": tier,
			"hp": hp, "maxHp": hp,
			"biome": q["biome"],
			"destroyed": false,
			"spawnTimer": r.range_f(4.0, 26.0),
			"spawnRate": 0.85 + float(tier) * 0.30 + float(p) * 0.16,
			"threat": 1.0 + float(tier) * 0.55 + float(p) * 0.28,
			"guardCount": 4 + tier * 3,
			"bossSpawned": false,
			"discovered": false,
			"dungeonCleared": false,
			"name": "%s-%02d" % [Cfg.NEST_NAMES[i % Cfg.NEST_NAMES.size()], i + 1],
		})


func _nest_tier_for(q: Dictionary) -> int:
	var half := float(Cfg.WORLD_PX) / 2.0
	var d := GdMath.dist(q["x"], q["y"], half, half) / half
	var score := d * 0.72 + (float(q["hazard"]) - 0.6) * 0.38
	return int(GdMath.clampv(round(1.0 + (score - 0.30) / 0.075), 1.0, 10.0))


func _nest_count_near(x: float, y: float, radius: float) -> int:
	var n := 0
	for nest in nests:
		if nest.get("destroyed", false):
			continue
		if radius <= 0.0 or GdMath.dist(x, y, nest["x"], nest["y"]) <= radius:
			n += 1
	return n


func _place_major_pois(r: Rng) -> void:
	var p := planet_index
	if mode == "towerDefense":
		pois = []
		return
	var ruins := int(round((4.0 + float(r.range_i(0, 3)) + float(p)) * Cfg.MAP_SCALE * poi_scale))
	var min_gap := float(Cfg.TILE * 15)

	var self_ref := self
	var try_place := func(kind: String, count: int, min_dist_from_nest: float, extra: Dictionary) -> void:
		var placed_n := 0
		var guard := 0
		while placed_n < count and guard < 12000:
			guard += 1
			var x := r.range_f(float(Cfg.TILE * 8), float(Cfg.WORLD_PX - Cfg.TILE * 8))
			var y := r.range_f(float(Cfg.TILE * 8), float(Cfg.WORLD_PX - Cfg.TILE * 8))
			var tx := int(floor(x / Cfg.TILE))
			var ty := int(floor(y / Cfg.TILE))
			if not self_ref._is_clear_box(tx, ty, 3):
				continue
			if self_ref._nest_count_near(x, y, min_dist_from_nest) > 0:
				continue
			var clash := false
			for q in self_ref.pois:
				if GdMath.dist(x, y, q["x"], q["y"]) < min_gap:
					clash = true
					break
			if clash:
				continue
			var poi := {
				"id": "poi_%d" % self_ref.pois.size(),
				"kind": kind, "x": x, "y": y, "tx": tx, "ty": ty,
				"r": float(extra.get("r", 60.0)),
				"discovered": false, "looted": false,
				"biome": self_ref.biomes[ty * W + tx],
			}
			for k in extra.keys():
				poi[k] = extra[k]
			if kind == "ruin":
				poi["beaconSalvage"] = true
				poi["beaconTaken"] = false
				var ruin_i := 0
				for q in self_ref.pois:
					if q["kind"] == "ruin":
						ruin_i += 1
				poi["name"] = Cfg.RUIN_NAMES[ruin_i % Cfg.RUIN_NAMES.size()]
				poi["pop"] = r.range_i(0, 2)
			elif kind == "obelisk":
				poi["name"] = "数据方尖碑"
			elif kind == "crash":
				poi["name"] = "坠毁旗舰"
			elif kind == "vault":
				poi["name"] = "实验 vault"
			self_ref.pois.append(poi)
			placed_n += 1

	try_place.call("ruin", ruins, float(Cfg.TILE * 18), { "r": 96.0 })
	try_place.call("crash", 1 + (1 if p > 0 else 0) + int(round(Cfg.MAP_SCALE - 1.0)), float(Cfg.TILE * 14), { "r": 120.0 })
	try_place.call("obelisk", int(round((2.0 + float(r.range_i(0, 2))) * Cfg.MAP_SCALE)), float(Cfg.TILE * 12), { "r": 40.0 })
	try_place.call("vault", int(round(maxf(1.0, 3.0 - float(p)) * Cfg.MAP_SCALE)), float(Cfg.TILE * 26), { "r": 70.0 })


# =========================================================
#  起始区 / 焦土
# =========================================================

func _carve_starter_zone(r: Rng) -> void:
	if landing_sites.is_empty():
		return
	var site: Dictionary = landing_sites[0]
	base_site = { "x": site["x"], "y": site["y"], "tx": site["tx"], "ty": site["ty"], "radius": 0.0 }
	prepare_base_area(site["tx"], site["ty"])
	if mode == "towerDefense":
		carve_arena(site["tx"], site["ty"])


func carve_arena(tx: int, ty: int, radius: int = 24) -> void:
	for y in range(ty - radius, ty + radius + 1):
		for x in range(tx - radius, tx + radius + 1):
			if x < 2 or y < 2 or x >= W - 2 or y >= W - 2:
				continue
			var d := sqrt(pow(float(x - tx), 2.0) + pow(float(y - ty), 2.0))
			if d > float(radius):
				continue
			var idx := y * W + x
			if d <= 7.0:
				tiles[idx] = Cfg.T_CONCRETE
				biomes[idx] = Cfg.B_BASIN
			elif d <= 11.0:
				tiles[idx] = Cfg.T_REGOLITH
				biomes[idx] = Cfg.B_BASIN
			elif Cfg.is_solid_tile(tiles[idx]):
				tiles[idx] = Cfg.T_REGOLITH


func prepare_base_area(tx: int, ty: int) -> Dictionary:
	var radius := 13
	for y in range(ty - radius, ty + radius + 1):
		for x in range(tx - radius, tx + radius + 1):
			if x < 1 or y < 1 or x >= W - 1 or y >= W - 1:
				continue
			var d := sqrt(pow(float(x - tx), 2.0) + pow(float(y - ty), 2.0))
			if d > float(radius):
				continue
			var idx := y * W + x
			if d <= 8.0:
				tiles[idx] = Cfg.T_CONCRETE if d <= 6.5 else Cfg.T_REGOLITH
				biomes[idx] = Cfg.B_BASIN
			elif Cfg.is_solid_tile(tiles[idx]):
				continue
			elif d <= 9.0 and tiles[idx] != Cfg.T_CONCRETE:
				tiles[idx] = Cfg.T_REGOLITH
	return { "x": float(tx * Cfg.TILE) + Cfg.TILE / 2.0, "y": float(ty * Cfg.TILE) + Cfg.TILE / 2.0 }


func _apply_scars() -> void:
	for nest in nests:
		var tr := int(nest["tier"]) * 3 + 6
		var tx := int(floor(float(nest["x"]) / Cfg.TILE))
		var ty := int(floor(float(nest["y"]) / Cfg.TILE))
		for y in range(ty - tr, ty + tr + 1):
			for x in range(tx - tr, tx + tr + 1):
				if x < 1 or y < 1 or x >= W - 1 or y >= W - 1:
					continue
				var d := sqrt(pow(float(x - tx), 2.0) + pow(float(y - ty), 2.0))
				if d > float(tr):
					continue
				var idx := y * W + x
				if Cfg.is_solid_tile(tiles[idx]):
					continue
				var p := 1.0 - d / float(tr)
				var rr := Rng.new(seed + ":scar:" + str(idx)).next_f()
				if rr < p * 0.85:
					tiles[idx] = Cfg.T_SCORCHED
					biomes[idx] = Cfg.B_SCAR
				elif rr < p * 0.95:
					tiles[idx] = Cfg.T_ASH
					biomes[idx] = Cfg.B_ASHLANDS
		nest["scarRadius"] = float(tr * Cfg.TILE)


# =========================================================
#  分阶段哈希（诊断用）
# =========================================================

func _hash_stage(name: String) -> void:
	var h := 2166136261
	for i in AREA:
		h = GdMath.imul(h ^ tiles[i], 16777619)
		h = GdMath.imul(h ^ biomes[i], 16777619)
	stage_hashes[name] = h & GdMath.U32


## 地形哈希（与黄金值对比用）
func tiles_hash() -> int:
	var h := 2166136261
	for i in AREA:
		h = GdMath.imul(h ^ tiles[i], 16777619)
	return h & GdMath.U32


# =========================================================
#  查询 API（与 JS World 同名同义）
# =========================================================

var flow: FlowField = null


func ensure_flow() -> FlowField:
	if flow == null:
		flow = FlowField.new(W, W, Cfg.FLOW_CELL)
	return flow


func tile_at_px(wx: float, wy: float) -> int:
	var tx := int(floor(wx / float(Cfg.TILE)))
	var ty := int(floor(wy / float(Cfg.TILE)))
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return Cfg.T_VOID
	return tiles[ty * W + tx]


func tile_at(tx: int, ty: int) -> int:
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return Cfg.T_VOID
	return tiles[ty * W + tx]


func biome_at_px(wx: float, wy: float) -> int:
	var tx := int(floor(wx / float(Cfg.TILE)))
	var ty := int(floor(wy / float(Cfg.TILE)))
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return Cfg.B_HIGHLAND
	return biomes[ty * W + tx]


func speed_at_px(wx: float, wy: float) -> float:
	var t := tile_at_px(wx, wy)
	var defs: Dictionary = _data().table("tiles", "TILE_DEF", {})
	var d = defs.get(str(t), defs.get(t, null))
	if d is Dictionary:
		return float(d.get("speed", 1.0))
	return 1.0


func is_blocked_px(wx: float, wy: float) -> bool:
	var tx := int(floor(wx / float(Cfg.TILE)))
	var ty := int(floor(wy / float(Cfg.TILE)))
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return true
	var idx := ty * W + tx
	return Cfg.is_solid_tile(tiles[idx]) or blocked[idx] != 0


## 圆形是否撞到不可通行地形（中心 + 8 个方向采样，与 JS 完全一致）
func circle_blocked(wx: float, wy: float, r: float) -> bool:
	if is_blocked_px(wx, wy):
		return true
	var steps := 8
	for i in steps:
		var a := (float(i) / float(steps)) * PI * 2.0
		if is_blocked_px(wx + cos(a) * r, wy + sin(a) * r):
			return true
	return false


## 沿直线是否有阻挡（子弹/视线）
func line_blocked(x0: float, y0: float, x1: float, y1: float) -> bool:
	var d := GdMath.dist(x0, y0, x1, y1)
	var steps := int(ceil(d / (float(Cfg.TILE) * 0.5)))
	for i in range(1, steps + 1):
		var t := float(i) / float(steps)
		if is_blocked_px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t):
			return true
	return false


## 逐轴移动 + 贴墙滑行（与 JS `enemies.tryMove` 同一套算法）。
##
## 玩家反馈过「有的怪会对目标走直线撞墙卡住」。这条算法的关键就是
## **两个轴分开判定**：X 被挡住时仍然允许 Y 移动，于是怪会自然沿墙滑行，
## 而不是一头顶死在墙上。返回 { x, y, hitWallX, hitWallY }。
func try_move(x: float, y: float, r: float, dx: float, dy: float, flying: bool = false) -> Dictionary:
	if flying:
		return {
			"x": GdMath.clampv(x + dx, float(Cfg.TILE), float(W * Cfg.TILE - Cfg.TILE)),
			"y": GdMath.clampv(y + dy, float(Cfg.TILE), float(W * Cfg.TILE - Cfg.TILE)),
			"hitWallX": false, "hitWallY": false,
		}
	var nx := x + dx
	var ny := y + dy
	var hit_x := false
	var hit_y := false
	if not circle_blocked(nx, y, r * 0.8):
		x = nx
	else:
		hit_x = true
	if not circle_blocked(x, ny, r * 0.8):
		y = ny
	else:
		hit_y = true
	return { "x": x, "y": y, "hitWallX": hit_x, "hitWallY": hit_y }


## 在世界里找一个离 (x,y) 最近的空地（黄金角螺旋）
func find_open_spot(x: float, y: float, r: float = 60.0, max_tries: int = 40) -> Dictionary:
	if not circle_blocked(x, y, 12.0):
		return { "x": x, "y": y }
	for i in range(1, max_tries + 1):
		var a := float(i) * 2.399963
		var rad := r * sqrt(float(i) / float(max_tries))
		var px := x + cos(a) * rad
		var py := y + sin(a) * rad
		if not circle_blocked(px, py, 12.0):
			return { "x": px, "y": py }
	return { "x": x, "y": y }


# ---- 地块改写 ----

var modified_tiles: Dictionary = {}
var tile_revision := 0


func set_tile(tx: int, ty: int, type: int) -> bool:
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return false
	var idx := ty * W + tx
	if tiles[idx] == type:
		return false
	tiles[idx] = type
	modified_tiles[idx] = { "t": type, "b": biomes[idx] }
	tile_revision += 1
	return true


func set_biome(tx: int, ty: int, biome: int) -> bool:
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return false
	var idx := ty * W + tx
	if biomes[idx] == biome:
		return false
	biomes[idx] = biome
	modified_tiles[idx] = { "t": tiles[idx], "b": biome }
	return true


func set_blocked(tx: int, ty: int, on: bool) -> void:
	if tx < 0 or ty < 0 or tx >= W or ty >= W:
		return
	blocked[ty * W + tx] = 1 if on else 0


func biomes_hash() -> int:
	var h := 2166136261
	for i in AREA:
		h = GdMath.imul(h ^ biomes[i], 16777619)
	return h & GdMath.U32


func variant_hash() -> int:
	var h := 2166136261
	for i in AREA:
		h = GdMath.imul(h ^ variant[i], 16777619)
	return h & GdMath.U32
