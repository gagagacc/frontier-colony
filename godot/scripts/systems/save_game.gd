## 存档 / 读档 —— `runState.serialize()/restore()` 的移植（阶段 12）。
##
## 为什么要单独写这么一层、还专门上断言：JS 版在这里踩过一个**静默**大坑 ——
## `serializeBases()` 忘了存 `r`（核心舱交互半径），读档后 `b.r` 是 undefined，
## 判定 `dist < b.r + 40` 变成 `NaN < 136` → **永远 false** →
## 「按 E 重建核心舱」完全没反应，而且不报任何错。玩家报的就是这个。
##
## 所以这里的规矩：
##   1. 每个字段都要有**显式默认值**（缺字段不许变成 NaN/0 静默生效）；
##   2. 存档带 `version`，将来加字段能兼容旧档；
##   3. 往返（存→读→再存）必须逐字段一致，且有专门的断言盯着上面那个坑。
class_name SaveGame

const VERSION := 1
const DIR := "user://saves"

## 参与存档的字段（显式列出，防止「加了字段忘了存」）
const TRAP_FIELDS := ["bases.r", "beacon.x", "beacon.y", "towers.onPlatform"]


static func slot_path(slot: String) -> String:
	var safe := slot.replace("/", "_").replace("\\", "_").replace("..", "_")
	return "%s/%s.json" % [DIR, safe]


## 把一局的状态收成一个 Dictionary（**所有字段都从这里走**）
static func serialize(game) -> Dictionary:
	var run_towers: Array = []
	for t in game.towers.towers:
		run_towers.append({
			"type": String(t["type"]), "x": float(t["x"]), "y": float(t["y"]),
			"hp": float(t["hp"]), "hpMax": float(t["hpMax"]), "level": int(t["level"]),
			"onPlatform": GdMath.truthy(t["onPlatform"]),
		})
	var run_structs: Array = []
	for s in game.towers.structures:
		run_structs.append({
			"type": String(s["type"]), "x": float(s["x"]), "y": float(s["y"]),
			"hp": float(s["hp"]), "blocks": GdMath.truthy(s.get("blocks", false)),
		})
	var bases: Array = []
	for b in game.towers.bases:
		bases.append({
			"x": float(b["x"]), "y": float(b["y"]),
			# ↓ 就是这一行：JS 版漏了它，导致读档后按 E 重建毫无反应
			"r": float(b.get("r", 96.0)),
			"buildRadius": float(b.get("buildRadius", 520.0)),
			"destroyed": GdMath.truthy(b.get("destroyed", false)),
		})
	var harvested: Array = []
	for id in game.props.harvested.keys():
		var rec = game.props.harvested[id]
		if rec is Dictionary:
			harvested.append({ "id": String(id), "t": float(rec["t"]), "type": String(rec["type"]),
				"x": float(rec["x"]), "y": float(rec["y"]) })
	var experiments: Array = []
	for id in game.experiments.keys():
		experiments.append([String(id), int(game.experiments[id])])
	return {
		"version": VERSION,
		"seed": game.world.seed,
		"planetIndex": int(game.world.planet_index),
		"characterId": game.tech.char_id,
		"time": 0.0,
		"resources": game.props_layer.resources.duplicate(true),
		"unlockedTech": game.tech.unlocked.keys(),
		"experiments": experiments,
		"player": {
			"x": float(game.player.position.x), "y": float(game.player.position.y),
			"hp": float(game.player.hp), "hpMax": float(game.player.hp_max),
			"level": 1, "xp": 0.0,
			"ammo": int(game.player.loadout.ammo), "ammoMax": int(game.player.loadout.ammo_max),
			"weapon": String(game.player.loadout.def.get("id", "pistol")),
			"rarity": String(game.player.loadout.rarity),
			"deaths": int(game.player.deaths),
		},
		"bases": bases,
		"towers": run_towers,
		"structures": run_structs,
		"vehicle": {
			"x": float(game.vehicle.x), "y": float(game.vehicle.y),
			"hp": float(game.vehicle.hp), "hpMax": float(game.vehicle.hp_max),
			"fuel": float(game.vehicle.fuel), "destroyed": GdMath.truthy(game.vehicle.destroyed),
			"turrets": game.vehicle.turrets.duplicate(),
		},
		"beacon": {
			"x": float(game.director.beacon_x), "y": float(game.director.beacon_y),
			"level": int(game.director.beacon_level), "fuel": float(game.director.beacon_fuel),
			"online": GdMath.truthy(game.director.beacon_online),
		},
		"wave": {
			"number": int(game.director.wave_number),
			"state": int(game.director.state), "timer": float(game.director.timer),
			"huntMode": GdMath.truthy(game.director.hunt_mode),
			"huntReason": String(game.director.hunt_reason),
		},
		"harvested": harvested,
		"stats": {
			"kills": int(game.enemies.kills), "deaths": int(game.player.deaths),
			"towersBuilt": int(game.towers.built), "wavesStarted": int(game.director.waves_started),
			"harvested": int(game.props_layer.harvested_count),
		},
	}


## 存到槽位（返回是否成功）
static func save(game, slot: String = "slot1") -> bool:
	var data := serialize(game)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DIR))
	var f := FileAccess.open(slot_path(slot), FileAccess.WRITE)
	if f == null:
		push_error("存档写入失败：%s" % slot_path(slot))
		return false
	f.store_string(JSON.stringify(data, "  "))
	f.close()
	# 立刻读回来校验一次（写坏了要当场知道，而不是等玩家读档时才发现）
	var back := load_data(slot)
	return not back.is_empty()


static func load_data(slot: String = "slot1") -> Dictionary:
	var path := slot_path(slot)
	if not FileAccess.file_exists(path):
		return {}
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return {}
	var parsed = JSON.parse_string(text)
	if not (parsed is Dictionary):
		push_error("存档解析失败：%s" % path)
		return {}
	var d: Dictionary = parsed
	if int(d.get("version", 0)) != VERSION:
		# 版本不匹配：仍然尝试读，但缺字段一律走默认值（宁可少东西也别崩）
		push_warning("存档版本 %s ≠ %d，按兼容模式读取" % [str(d.get("version")), VERSION])
	return d


static func list_slots() -> Array:
	var out: Array = []
	var dir := DirAccess.open(DIR)
	if dir == null:
		return out
	for name in dir.get_files():
		if name.ends_with(".json"):
			out.append(name.trim_suffix(".json"))
	out.sort()
	return out


## 把存档灌回一局（**每一项都带默认值**）
static func restore(game, data: Dictionary) -> bool:
	if data.is_empty():
		return false
	var p: Dictionary = data.get("player", {})
	game.player.position = Vector2(float(p.get("x", 0.0)), float(p.get("y", 0.0)))
	game.player.hp_max = float(p.get("hpMax", 122.0))
	game.player.hp = float(p.get("hp", game.player.hp_max))
	game.player.deaths = int(p.get("deaths", 0))
	if game.player.loadout != null:
		game.player.loadout.ammo = int(p.get("ammo", 160))
		game.player.loadout.ammo_max = int(p.get("ammoMax", 200))
		game.player.loadout.rarity = String(p.get("rarity", "common"))

	game.props_layer.resources = (data.get("resources", {}) as Dictionary).duplicate(true)

	game.tech.unlocked.clear()
	for id in data.get("unlockedTech", []):
		game.tech.unlocked[String(id)] = true
	game.experiments.clear()
	for pair in data.get("experiments", []):
		if pair is Array and pair.size() >= 2:
			game.experiments[String(pair[0])] = int(pair[1])
	game._recompute_stats()

	# 基础/塔/建筑：每一项都要默认值，缺一个就会在别处变成 NaN 比较
	var bases: Array = []
	for b in data.get("bases", []):
		bases.append({
			"x": float(b.get("x", 0.0)), "y": float(b.get("y", 0.0)),
			"r": float(b.get("r", 96.0)),
			"buildRadius": float(b.get("buildRadius", 520.0)),
			"destroyed": GdMath.truthy(b.get("destroyed", false)),
		})
	if not bases.is_empty():
		game.towers.bases = bases
	var tf: Dictionary = DataLoader.new().table("towers", "TOWER_DEF", {})
	game.towers.towers.clear()
	for t in data.get("towers", []):
		var def: Dictionary = tf.get(String(t.get("type", "")), {})
		if def.is_empty():
			continue
		game.towers.towers.append({
			"id": game.towers.towers.size() + 1, "type": String(t["type"]), "def": def,
			"x": float(t.get("x", 0.0)), "y": float(t.get("y", 0.0)), "r": 18.0,
			"angle": -PI / 2.0, "level": int(t.get("level", 1)),
			"hp": float(t.get("hp", 100.0)), "hpMax": float(t.get("hpMax", 100.0)),
			"armor": DataLoader.num_or(def, "armor", 4.0), "cd": 0.0,
			"building": false, "buildProgress": 1.0, "target": null, "kills": 0,
			"damageDealt": 0.0, "onPlatform": GdMath.truthy(t.get("onPlatform", false)),
		})
	game.towers.structures.clear()
	for s in data.get("structures", []):
		game.towers.structures.append({
			"type": String(s.get("type", "")), "x": float(s.get("x", 0.0)), "y": float(s.get("y", 0.0)),
			"hp": float(s.get("hp", 100.0)), "maxHp": float(s.get("hp", 100.0)),
			"blocks": GdMath.truthy(s.get("blocks", false)), "r": 18.0,
		})

	var v: Dictionary = data.get("vehicle", {})
	game.vehicle.x = float(v.get("x", 0.0))
	game.vehicle.y = float(v.get("y", 0.0))
	game.vehicle.hp_max = float(v.get("hpMax", 420.0))
	game.vehicle.hp = float(v.get("hp", game.vehicle.hp_max))
	game.vehicle.fuel = float(v.get("fuel", Vehicle.FUEL_MAX))
	game.vehicle.destroyed = GdMath.truthy(v.get("destroyed", false))
	game.vehicle.turrets = (v.get("turrets", []) as Array).duplicate()

	var b: Dictionary = data.get("beacon", {})
	game.director.beacon_x = float(b.get("x", game.world.base_site["x"] if game.world.base_site != null else 0.0))
	game.director.beacon_y = float(b.get("y", game.world.base_site["y"] if game.world.base_site != null else 0.0))
	game.director.beacon_level = int(b.get("level", 0))
	game.director.beacon_fuel = float(b.get("fuel", Director.FUEL_MAX))
	game.director.beacon_online = GdMath.truthy(b.get("online", true))
	game.director.beacon_radius = game.director.beacon_radius_for(game.director.beacon_level)
	game.director.beacon_intensity = game.director.beacon_intensity_for(game.director.beacon_level)

	var w: Dictionary = data.get("wave", {})
	game.director.wave_number = int(w.get("number", 0))
	game.director.state = int(w.get("state", Director.State.CALM))
	game.director.timer = float(w.get("timer", 30.0))
	if GdMath.truthy(w.get("huntMode", false)):
		game.director.start_hunt(String(w.get("huntReason", "fuel")))

	game.props.harvested.clear()
	for h in data.get("harvested", []):
		game.props.harvested[String(h.get("id", ""))] = {
			"t": float(h.get("t", 0.0)), "type": String(h.get("type", "")),
			"x": float(h.get("x", 0.0)), "y": float(h.get("y", 0.0)),
		}

	var st: Dictionary = data.get("stats", {})
	game.enemies.kills = int(st.get("kills", 0))
	game.towers.built = int(st.get("towersBuilt", 0))
	game.director.waves_started = int(st.get("wavesStarted", 0))
	game.props_layer.harvested_count = int(st.get("harvested", 0))
	return true
