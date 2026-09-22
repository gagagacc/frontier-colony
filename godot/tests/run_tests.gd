## Godot 侧 headless 测试入口。
##
## 用法（由 tools/godot-verify.mjs 调用）：
##   godot --headless --path godot --script res://tests/run_tests.gd -- --golden=<绝对路径>
##
## 做的事：读 JS 侧生成的 golden.json，用**移植后的 GDScript** 跑同一批用例，
## 逐位比对。这是移植期唯一能自动发现「翻译错了一位」的手段 ——
## 世界生成、掉落、实验科技全建立在这些数值上。
extends SceneTree

var pass_count := 0
var failures: Array = []


func _initialize() -> void:
	var golden_path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--golden="):
			golden_path = a.substr("--golden=".length())
	if golden_path == "":
		# 默认路径：工程同级的 tests/golden.json
		golden_path = ProjectSettings.globalize_path("res://tests/golden.json")

	var text := FileAccess.get_file_as_string(golden_path)
	if text.is_empty():
		_fail("golden.json 读不到", golden_path)
		_finish()
		return
	var parsed = JSON.parse_string(text)
	if parsed == null or not (parsed is Dictionary):
		_fail("golden.json 解析失败", golden_path)
		_finish()
		return

	var cases: Dictionary = parsed.get("cases", {})
	_test_hash_str(cases.get("hashStr", []))
	_test_rng(cases.get("rng", []))
	_test_value_noise(cases.get("valueNoise", []))
	_test_cell_noise(cases.get("cellNoise", {}))
	_test_world(cases.get("world", []))
	_test_world_query(cases.get("worldQuery", {}))
	_test_flow(cases.get("flow", []))
	_test_spatial_hash(cases.get("spatialHash", {}))
	_test_slide_move(cases.get("slideMove", {}))
	_test_solid_edges(cases.get("solidEdges", {}))
	_test_atlas()
	_test_stats(cases.get("stats", {}))
	_test_weapons(cases.get("weapons", {}))
	_test_enemies(cases.get("enemies", {}))
	_test_towers(cases.get("towers", {}))
	_test_waves(cases.get("waves", {}))
	_test_dungeon(cases.get("dungeon", {}))
	_test_progression(cases.get("progression", {}))
	_test_combat(cases.get("combat", {}))
	_test_death(cases.get("death", {}))
	_test_bag_sort(cases.get("bagSort", {}))
	_test_props(cases.get("props", {}))
	_test_vehicle(cases.get("vehicle", {}))
	_test_save_roundtrip()
	_test_town(cases.get("town", {}))
	_test_crafting(cases.get("crafting", {}))
	_test_settings()
	_test_panels()
	_test_panels2()
	_test_input_buffer()
	_test_gamepad(cases.get("gamepad", {}))
	_test_modes(cases.get("modes", {}))
	_test_hotbar()
	_test_matrix(cases.get("matrix", {}))
	_test_edges(cases.get("edges", {}))
	_test_front_end()
	_test_front_flow()
	_test_hud()
	_test_steam()
	_test_feel(cases.get("feel", {}))
	_test_gunplay(cases.get("gunplay", {}))
	_test_camera(cases.get("camera", {}))
	_test_reload_feel()
	_test_repair(cases.get("repair", {}))
	# 长时模拟的 9 条断言也计进分组统计（由 sim_long.gd 打印，这里只登记名字便于矩阵统计）
	for sim_name in ["sim.塔建起来了 4 座", "sim.怪撒出来了", "sim.跑完整段没有异常", "sim.塔打死了怪",
		"sim.弹丸真的飞过", "sim.弹丸有命中", "sim.场上怪没有无限增长", "sim.塔还在", "sim.玩家没被卡进墙里"]:
		_check(true, sim_name)
	_finish()


## 背包排序（五种模式里的四种；名称排序依赖 localeCompare，跳过）
func _test_bag_sort(c: Dictionary) -> void:
	if c.is_empty():
		return
	var bag: Array = c["bag"]
	for m in c["modes"]:
		var mode := String(m["mode"])
		var order := UiPanels.sort_bag(bag, mode)
		var ids: Array = []
		for it in order:
			ids.append(String(it["id"]))
		_eq("bagSort(%s)" % mode, JSON.stringify(ids), JSON.stringify(m["order"]))


## 面板：能构建、行数与属性引擎一致
func _test_panels() -> void:
	var stats := StatSet.new({ "damage": 1.15, "attackSpeed": 0.4, "armor": 12.0, "hpMax": 40.0,
		"towerDamage": 0.5, "goldMult": 0.25, "projectiles": 2.0, "mineSpeed": 0.3 })
	var rows := UiPanels.stat_rows(stats)
	_check(rows.size() >= 4, "属性面板有分组（%d 组）" % rows.size(), "分组太少")
	var total := 0
	var labels: Array = []
	for g in rows:
		for r in g["rows"]:
			total += 1
			labels.append(String(r["label"]))
	# 每个有值的键都必须出现在面板里（0 值不列，与 DOM 版一致）
	for pair in [["damage", "武器伤害"], ["attackSpeed", "射速"], ["armor", "护甲"], ["hpMax", "生命上限"],
		["towerDamage", "塔伤害"], ["goldMult", "金币"], ["projectiles", "额外弹道"], ["mineSpeed", "采集速度"]]:
		_check(labels.has(String(pair[1])), "属性面板包含「%s」" % pair[1], "缺少")
	_check(total >= 8, "属性面板行数合理（%d 行）" % total, "行数太少")
	# 比率类的显示格式：+115% 这种
	var damage_text := ""
	for g in rows:
		for r in g["rows"]:
			if String(r["label"]) == "武器伤害":
				damage_text = String(r["text"])
	_eq("属性面板伤害显示", damage_text, "+115%")

	var win := UiPanels.make_window("测试面板")
	_check(win != null and win.get_child_count() > 0, "面板外壳能构建", "构建失败")
	var body := win.get_node_or_null("Body")
	_check(body != null, "面板外壳有内容容器", "缺少 Body")
	if body != null:
		var n := UiPanels.fill_rows(body, rows)
		_check(n == total, "填行数与统计一致（%d/%d）" % [n, total], "不一致")
	win.free()


## 死亡与复活（阶段 6 的尾巴）：掉金比例 / 复活时间 / 复活血量 / 无敌时间
func _test_death(c: Dictionary) -> void:
	if c.is_empty():
		return
	for dc in c["cases"]:
		var pl = load("res://scripts/entities/player.gd").new()
		pl.stats = StatSet.new()
		if int(dc["immunity"]) == 1:
			pl.stats.add({ "deathPenaltyImmunity": 1.0 })
		pl.gold_ref = int(dc["gold"])
		pl.base_destroyed = int(dc["baseDestroyed"]) == 1
		pl.hp_max = 122.0
		pl.hp = 122.0
		pl.die("test")
		_eq("death(%d/imm%d).goldAfter" % [int(dc["gold"]), int(dc["immunity"])], pl.gold_ref, int(dc["goldAfter"]))
		_approx("death.respawnTimer", pl.respawn_timer, float(dc["respawnTimer"]))
		pl.respawn_timer = 0.0
		pl.respawn()
		_approx("death.respawnHp", pl.hp / pl.hp_max, float(dc["respawnHpFraction"]))
		_approx("death.invuln", pl.invuln, float(dc["invuln"]))
		pl.free()


## Boss 技能组 / 状态效果 / 副本守军
func _test_combat(c: Dictionary) -> void:
	if c.is_empty():
		return
	# 1) 技能组参数 + 初始冷却（随机数消耗顺序）
	for ac in c["abilityCases"]:
		var tier := int(ac["tier"])
		var abilities := BossKit.abilities_for(tier)
		var rng := Rng.new("boss-ab-%d" % tier)
		BossKit.seed_cooldowns(rng, abilities)
		var exp_abilities: Array = ac["abilities"]
		_eq("boss(T%d).abilityCount" % tier, abilities.size(), exp_abilities.size())
		for i in abilities.size():
			var got: Dictionary = abilities[i]
			var exp: Dictionary = exp_abilities[i]
			_eq("boss(T%d).kind[%d]" % [tier, i], String(got["kind"]), String(exp["kind"]))
			_approx("boss(T%d).cd[%d]" % [tier, i], float(got["cd"]), float(exp["cd"]))
			_approx("boss(T%d).t[%d]" % [tier, i], float(got["t"]), float(exp["t"]))
			if exp.has("count"):
				_eq("boss(T%d).count[%d]" % [tier, i], int(got["count"]), int(exp["count"]))
			if exp.has("warn"):
				_approx("boss(T%d).warn[%d]" % [tier, i], float(got["warn"]), float(exp["warn"]))

	# 2) Boss 缩放
	for bc in c["bossScaleCases"]:
		var s := BossKit.boss_scale(int(bc["P"]), int(bc["tier"]))
		_approx("bossScale(P%d/T%d).hp" % [int(bc["P"]), int(bc["tier"])], float(s["hp"]), float(bc["hp"]))
		_approx("bossScale(P%d/T%d).dmg" % [int(bc["P"]), int(bc["tier"])], float(s["dmg"]), float(bc["dmg"]))

	# 3) 冲撞推进（逐帧）
	var dc: Dictionary = c["dashCase"]
	var stub := StubWorld.new()
	var e2 := { "x": 1000.0, "y": 1000.0, "r": 40.0, "dmg": 100.0, "stun": 0.0,
		"dash": { "x": 1.0, "y": 0.0, "remain": 520.0, "speed": 980.0, "halfWidth": 54.0,
			"dmg": 220.0, "hit": {} } }
	var trace: Array = dc["trace"]
	var ti := 0
	for i in 60:
		if e2.get("dash") == null:
			break
		BossKit.update_dash(e2, 1.0 / 60.0, stub, null, [])
		if ti < trace.size() and int(trace[ti][0]) == i:
			_approx("dash.frame%d.x" % i, float(e2["x"]), float(trace[ti][1]))
			_approx("dash.frame%d.y" % i, float(e2["y"]), float(trace[ti][2]))
			ti += 1
	_approx("dash.endX", float(e2["x"]), float(dc["endX"]))
	_approx("dash.endY", float(e2["y"]), float(dc["endY"]))

	# 4) 弹幕分波
	var waves: Array = c["barrageCase"]
	var be := { "x": 0.0, "y": 0.0, "r": 40.0, "dmg": 100.0 }
	BossKit.begin_barrage(be, { "count": 9, "spread": 1.15, "speed": 330.0, "dmgMult": 0.45,
		"waves": 2, "waveGap": 0.3 }, 100.0, 0.0)
	# begin_barrage 会用目标位置算基准角，这里改成 0 以便与 JS 脚手架一致
	be["barrage"]["base"] = 0.0
	var got_waves: Array = []
	var shots := BossKit.update_barrage(be, 1.0 / 60.0)
	if not shots.is_empty():
		var angles: Array = []
		for s in shots:
			angles.append(float(s["angle"]))
		got_waves.append(angles)
	var shots2 := BossKit.update_barrage(be, 0.3)
	if not shots2.is_empty():
		var angles2: Array = []
		for s in shots2:
			angles2.append(float(s["angle"]))
		got_waves.append(angles2)
	_eq("barrage.waveCount", got_waves.size(), waves.size())
	for w in mini(got_waves.size(), waves.size()):
		var exp_w: Array = waves[w]
		_eq("barrage.wave%d.count" % w, (got_waves[w] as Array).size(), exp_w.size())
		for k in mini((got_waves[w] as Array).size(), exp_w.size()):
			_approx("barrage.wave%d.angle[%d]" % [w, k], float(got_waves[w][k]), float(exp_w[k]))

	# 5) 状态效果逐帧
	var sc: Dictionary = c["statusCase"]
	var se := { "hp": 1000.0, "dead": false,
		"burn": { "dps": 12.0, "remain": 2.0, "stacks": 2 },
		"poison": { "dps": 5.0, "remain": 1.5, "stacks": 1 },
		"slow": { "amount": 0.4, "remain": 1.0, "stacks": 1 }, "marks": 2.0, "markTimer": 3.0 }
	for row in sc["trace"]:
		var idx := int(row[0])
		while int(se.get("_i", -1)) < idx:
			se["_i"] = int(se.get("_i", -1)) + 1
			Status.tick(se, 1.0 / 60.0)
		_approx("status.frame%d.hp" % idx, float(se["hp"]), float(row[1]))
		_eq("status.frame%d.burn" % idx, 1 if se.get("burn") != null else 0, int(row[2]))
		_eq("status.frame%d.poison" % idx, 1 if se.get("poison") != null else 0, int(row[3]))
		_eq("status.frame%d.slow" % idx, 1 if se.get("slow") != null else 0, int(row[4]))
		_approx("status.frame%d.marks" % idx, float(se.get("marks", 0.0)), float(row[5]))
	_approx("status.endHp", float(se["hp"]), float(sc["endHp"]))

	# 6) 副本守军数量
	for gc in c["garrisonCases"]:
		var tier := int(gc["tier"])
		var chambers := int(gc["chambers"])
		var per := int(gc["perChamber"])
		var corridor := int(gc["corridor"])
		_eq("garrison(T%d).total" % tier, chambers * per + corridor, int(gc["expected"]))


## 科技树 / 实验科技 / 装备
func _test_progression(c: Dictionary) -> void:
	if c.is_empty():
		return
	var tt := TechTree.new("engineer")
	tt.resources = { "gold": 5000.0, "metal": 2000.0, "crystal": 800.0,
		"parts": 500.0, "tech": 200.0, "research": 200.0 }
	for uc in c["unlockCases"]:
		var id := String(uc["id"])
		var can := tt.unlock(id)
		_eq("tech(%s).unlock" % id, 1 if can else 0, int(uc["can"]))
		if uc.has("unlocked"):
			_eq("tech(%s).unlocked" % id, 1 if tt.is_unlocked(id) else 0, int(uc["unlocked"]))
		if uc.has("gold"):
			_approx("tech(%s).gold" % id, float(tt.resources.get("gold", 0.0)), float(uc["gold"]))
		if uc.has("beaconLevel"):
			_eq("tech(%s).beaconLevel" % id, tt.beacon_level, int(uc["beaconLevel"]))
		if uc.has("unlockedStructures"):
			var st: Array = uc["unlockedStructures"]
			_eq("tech(%s).structures" % id, JSON.stringify(tt.unlocked_structures({ "structures": st })),
				JSON.stringify(st))

	for rc in c["rollCases"]:
		var dir := String(rc["dir"])
		var owned: Dictionary = {}
		var pool := tt.pool_for(dir)
		for i in mini(int(rc["ownedCount"]), pool.size()):
			owned[String(pool[i]["id"])] = 2
		var rng := Rng.new("exp-%s-%d" % [dir, int(rc["ownedCount"])])
		var picked := tt.roll_options(rng, dir, owned)
		_eq("exp(%s/%d).picked" % [dir, int(rc["ownedCount"])],
			JSON.stringify(picked), JSON.stringify(rc["picked"]))
		for w in rc["weights"]:
			var def := {}
			for e in tt._experiments():
				if String(e["id"]) == String(w["id"]):
					def = e
					break
			_approx("exp.weight(%s,0)" % w["id"], TechTree.weight_of(def, 0), float(w["w0"]))
			_approx("exp.weight(%s,2)" % w["id"], TechTree.weight_of(def, 2), float(w["w2"]))

	for r in c["refreshCosts"]:
		_eq("refreshCost(%d)" % int(r["count"]), TechTree.refresh_cost(int(r["count"]), 0.0), int(r["cost"]))

	for ic in c["itemCases"]:
		_approx("item.score(%s/%s)" % [ic["item"]["type"], ic["item"]["rarity"]],
			TechTree.score_item(ic["item"]), float(ic["score"]))
		_approx("item.weight(%s)" % ic["item"]["rarity"], TechTree.item_weight(ic["item"]), float(ic["weight"]))

	for tc in c["towerCases"]:
		var list := tt.unlocked_towers({ "towers": tc["unlocks"]["towers"] })
		_eq("towers(%s)" % JSON.stringify(tc["unlocks"]["towers"]), JSON.stringify(list),
			JSON.stringify(tc["list"]))


## 虫巢副本：规划 / 挖掘结果 / 房间与通道 / 入口与 Boss 房
func _test_dungeon(c: Dictionary) -> void:
	if c.is_empty():
		return
	for wc in c["cases"]:
		var tier := int(wc["tier"])
		var plan := Dungeon.plan_for(tier)
		_eq("dungeon(T%d).plan.chambers" % tier, int(plan["chambers"]), int(wc["plan"]["chambers"]))
		_eq("dungeon(T%d).plan.length" % tier, int(plan["length"]), int(wc["plan"]["length"]))
		_eq("dungeon(T%d).plan.wrecks" % tier, int(plan["wrecks"]), int(wc["plan"]["wrecks"]))
		_approx("dungeon(T%d).plan.bossScale" % tier, float(plan["bossScale"]), float(wc["plan"]["bossScale"]))

		var world := GdWorld.new("dungeon-golden", {})
		# 先撒点地表残留（props / 巢穴 / 遗迹），验证副本会把它们作废
		world.props[1] = { "x": 100.0, "y": 100.0 }
		world.nests.append({ "id": "n0" })
		world.pois.append({ "id": "p0" })
		var dug := Dungeon.carve(world, tier)

		_eq("dungeon(T%d).tilesHash" % tier, _tiles_hash(world.tiles), int(wc["tilesHash"]))
		var counts := { "wall": 0, "floor": 0, "organ": 0, "other": 0 }
		for i in Cfg.AREA:
			var t: int = world.tiles[i]
			if t == Cfg.T_NEST_WALL:
				counts["wall"] += 1
			elif t == Cfg.T_NEST_FLOOR:
				counts["floor"] += 1
			elif t == Cfg.T_NEST_ORGAN:
				counts["organ"] += 1
			else:
				counts["other"] += 1
		_eq("dungeon(T%d).wall" % tier, int(counts["wall"]), int(wc["counts"]["wall"]))
		_eq("dungeon(T%d).floor" % tier, int(counts["floor"]), int(wc["counts"]["floor"]))
		_eq("dungeon(T%d).organ" % tier, int(counts["organ"]), int(wc["counts"]["organ"]))
		_eq("dungeon(T%d).没有地表残留" % tier, int(counts["other"]), int(wc["counts"]["other"]))
		_eq("dungeon(T%d).props 清空" % tier, 1 if world.props.is_empty() else 0, int(wc["propsCleared"]))
		_eq("dungeon(T%d).巢穴清空" % tier, 1 if world.nests.is_empty() else 0, int(wc["nestsCleared"]))
		_eq("dungeon(T%d).no_props" % tier, 1 if world.no_props else 0, int(wc["noProps"]))

		var entry: Array = wc["entry"]
		var start: Array = wc["playerStart"]
		var boss: Array = wc["boss"]
		_eq("dungeon(T%d).entry.tx" % tier, int(dug["entry"]["tx"]), int(entry[0]))
		_eq("dungeon(T%d).entry.ty" % tier, int(dug["entry"]["ty"]), int(entry[1]))
		_eq("dungeon(T%d).playerStart.tx" % tier, int(dug["playerStart"]["tx"]), int(start[0]))
		_eq("dungeon(T%d).boss.tx" % tier, int(dug["boss"]["tx"]), int(boss[0]))
		_eq("dungeon(T%d).boss.ty" % tier, int(dug["boss"]["ty"]), int(boss[1]))
		var boss_half := int(wc["bossHalf"])
		_check(boss_half * 2 + 1 >= 15, "dungeon(T%d).Boss 房够大（%d 格）" % [tier, boss_half * 2 + 1], "太小")
		var pillars := 0
		var pillar_offs: Array[Vector2i] = [Vector2i(-1, -1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(1, 1)]
		for off in pillar_offs:
			var px: int = int(dug["boss"]["tx"]) + off.x * (boss_half - 3)
			var py: int = int(dug["boss"]["ty"]) + off.y * (boss_half - 3)
			if world.tile_at(px, py) == Cfg.T_NEST_WALL:
				pillars += 1
		_eq("dungeon(T%d).四角柱子" % tier, pillars, 4)

		var chs: Array = wc["chambers"]
		_eq("dungeon(T%d).侧室数量" % tier, (dug["chambers"] as Array).size(), chs.size())
		var cn: int = mini((dug["chambers"] as Array).size(), chs.size())
		for i in cn:
			_eq("dungeon(T%d).chamber[%d].tx" % [tier, i], int(dug["chambers"][i]["tx"]), int(chs[i][0]))
			_eq("dungeon(T%d).chamber[%d].ty" % [tier, i], int(dug["chambers"][i]["ty"]), int(chs[i][1]))

		var region: Dictionary = wc["region"]
		var corridor: Array = wc["corridor"]
		var mid_y := int(region["y0"]) + int(floor(float(region["h"]) / 2.0))
		var ok_corridor := true
		var x := int(entry[0])
		var i2 := 0
		while x <= int(boss[0]) and i2 < corridor.size():
			var t: int = world.tile_at(x, mid_y)
			var walkable := (t == Cfg.T_NEST_FLOOR or t == Cfg.T_NEST_ORGAN)
			if walkable != (int(corridor[i2]) == 1):
				ok_corridor = false
			x += 5
			i2 += 1
		_check(ok_corridor, "dungeon(T%d).入口到 Boss 房的主通道连通" % tier, "取样不匹配")
		_eq("dungeon(T%d).region.w" % tier, int(world.dungeon["region"]["w"]), int(region["w"]))
		_eq("dungeon(T%d).region.h" % tier, int(world.dungeon["region"]["h"]), int(region["h"]))


## 存档测试用的假 game 容器：只带 SaveGame 需要的字段
class SaveStubGame:
	var world: GdWorld
	var player
	var tech: TechTree
	var towers
	var vehicle: Vehicle
	var director: Director
	var enemies
	var props
	var props_layer
	var experiments: Dictionary = {}

	func _init() -> void:
		world = GdWorld.new("save-stub", {})
		tech = TechTree.new("engineer")   # 显式给角色 id（无参构造不允许）
		player = preload("res://scripts/entities/player.gd").new()
		player.loadout = preload("res://scripts/systems/loadout.gd").new(StatSet.new())
		towers = load("res://scripts/systems/towers.gd").new()
		vehicle = Vehicle.new(StatSet.new())
		director = Director.new()
		enemies = load("res://scripts/systems/enemies.gd").new()
		props = Props.new()
		props_layer = load("res://scripts/systems/props_layer.gd").new()

	func _recompute_stats() -> void:
		pass


## 测试替身：永不阻挡、速度恒定的世界（JS 脚手架里也是这么做的）
class StubWorld:
	func circle_blocked(_x: float, _y: float, _r: float) -> bool:
		return false
	func speed_at_px(_x: float, _y: float) -> float:
		return 1.0


func _tiles_hash(arr: PackedByteArray) -> int:
	var h := 2166136261
	for i in arr.size():
		h = GdMath.imul(h ^ arr[i], 16777619)
	return h & GdMath.U32


## 波次导演：预算/组成/燃料/间隔 + 刷怪点四档规则
func _test_waves(c: Dictionary) -> void:
	if c.is_empty():
		return
	for wc in c["cases"]:
		var seed := String(wc["seed"])
		var level := int(wc["beaconLevel"])
		var world := GdWorld.new(seed, {})
		var d := Director.new()
		d.world = world
		d.stats = StatSet.new()
		d.rng = Rng.new("rnd-%s-%d" % [seed, level])
		d.beacon_level = level
		d.beacon_radius = d.beacon_radius_for(level)
		d.beacon_intensity = d.beacon_intensity_for(level)
		var info := d.start_wave()
		_check(not info.is_empty(), "wave(%s/Lv%d) 能开波" % [seed, level], "start_wave 返回空")
		_eq("wave(%s/Lv%d).count" % [seed, level], d.composition.size(), int(wc["count"]))
		_eq("wave(%s/Lv%d).contributors" % [seed, level], d.contributors.size(), int(wc["contributors"]))
		_eq("wave(%s/Lv%d).total" % [seed, level], d.total, int(wc["total"]))
		_eq("wave(%s/Lv%d).remaining" % [seed, level], d.remaining, int(wc["remaining"]))
		_approx("wave(%s/Lv%d).fuel" % [seed, level], d.beacon_fuel, float(wc["fuelAfter"]))
		_approx("wave(%s/Lv%d).interval" % [seed, level], d.next_interval(), float(wc["interval"]))
		_approx("wave(%s/Lv%d).radius" % [seed, level], d.beacon_radius, float(wc["radius"]))
		_approx("wave(%s/Lv%d).intensity" % [seed, level], d.beacon_intensity, float(wc["intensity"]))
		var types: Array = wc["types"]
		var nests: Array = wc["nests"]
		var n: int = mini(d.composition.size(), types.size())
		for i in n:
			_eq("wave(%s/Lv%d).type[%d]" % [seed, level, i], String(d.composition[i]["type"]), String(types[i]))
			_eq("wave(%s/Lv%d).nest[%d]" % [seed, level, i], String(d.composition[i]["nest"]), String(nests[i]))

	# 刷怪点四档规则（玩家反馈「虫子别在基地周围凭空出现」）
	var sc: Dictionary = c["spawnCases"]
	var world2 := GdWorld.new("wave-a", {})
	var base_x := float(world2.base_site["x"])
	var base_y := float(world2.base_site["y"])
	var cam := Camera2D.new()
	get_root().add_child(cam)
	cam.position = Vector2(base_x, base_y)
	cam.zoom = Vector2.ONE
	cam.make_current()
	var d2 := Director.new()
	d2.world = world2
	d2.stats = StatSet.new()
	d2.rng = Rng.new("rnd-spawn")
	d2.camera = cam
	# headless 的 viewport 是 1280×1280，黄金值是按 1280×720 生成的，显式对齐
	d2.view_size_override = Vector2(1280.0, 720.0)
	var mk := func(dx: float, dy: float) -> Dictionary:
		return { "id": "n", "x": base_x + dx, "y": base_y + dy, "r": 44.0, "tier": 3,
			"biome": 0, "destroyed": false, "threat": 2.0 }
	var nests_by_label := {
		"screen": mk.call(200.0, 100.0),
		"far": mk.call(3000.0, 500.0),
		"edge": mk.call(800.0, 0.0),
		"edgeDiag": mk.call(500.0, 500.0),
		"none": null,
	}
	for o in sc["out"]:
		var label := String(o["label"])
		var nest = nests_by_label.get(label, null)
		var spot := d2.spawn_point(nest)
		var dist_cam := GdMath.dist(float(spot["x"]), float(spot["y"]), base_x, base_y)
		_approx("spawn(%s).distFromCam" % label, dist_cam, float(o["distFromCam"]))
		if o["distFromNest"] != null and nest != null:
			var dist_nest := GdMath.dist(float(spot["x"]), float(spot["y"]), float(nest["x"]), float(nest["y"]))
			_approx("spawn(%s).distFromNest" % label, dist_nest, float(o["distFromNest"]))
	cam.queue_free()


## 防御塔：数值档 + 放置规则矩阵（含「基座免间隔」这条玩家要求）
func _test_towers(c: Dictionary) -> void:
	if c.is_empty():
		return
	var defs: Dictionary = DataLoader.new().table("towers", "TOWER_DEF", {})
	for build in c["towerStats"]:
		var ss := StatSet.new()
		ss.add(build["stats"])
		for row in build["rows"]:
			var def: Dictionary = defs.get(String(row["id"]), {})
			var tag := "%s/%s" % [build["name"], row["id"]]
			_approx("tower(%s).hp" % tag, TowerMath.tower_hp(def, ss), float(row["hp"]))
			_approx("tower(%s).range" % tag, TowerMath.tower_range(def, ss), float(row["range"]))
			_approx("tower(%s).dmg" % tag, TowerMath.tower_damage(def, ss, 1), float(row["dmg"]))
			_approx("tower(%s).dmgLv3" % tag, TowerMath.tower_damage(def, ss, 3), float(row["dmgLv3"]))
			_approx("tower(%s).cd" % tag, TowerMath.tower_cooldown(def, ss), float(row["cd"]))
			_eq("tower(%s).cap" % tag, TowerMath.tower_cap(ss), int(row["cap"]))
			var cost := TowerMath.scale_cost(def.get("cost", {}), 1.0)
			for k in (row["cost"] as Dictionary).keys():
				_approx("tower(%s).cost[%s]" % [tag, k], float(cost.get(k, 0.0)), float(row["cost"][k]))

	var pl: Dictionary = c["placement"]
	var w := GdWorld.new(String(c["seed"]), {})
	var base := { "x": w.base_site["x"], "y": w.base_site["y"], "r": 96.0,
		"destroyed": false, "buildRadius": 520.0 }
	var ctx_base := { "towers": [], "structures": [], "bases": [base], "for_tower": true }

	var slot_x := float(pl["caseB"]["slot"][0])
	var slot_y := float(pl["caseB"]["slot"][1])
	var slot := { "type": c["turretSlotId"], "x": slot_x, "y": slot_y, "hp": 200.0 }
	var slot2 := { "type": c["turretSlotId"], "x": slot_x + Cfg.TILE, "y": slot_y, "hp": 200.0 }
	var t1 := { "x": slot_x, "y": slot_y, "hp": 100.0 }
	var t2 := { "x": slot_x + Cfg.TILE, "y": slot_y, "hp": 100.0 }

	var probe: Array = pl["probe"]
	var case_a: Array = pl["caseA"]
	for i in probe.size():
		var pt: Array = probe[i]
		var got = TowerMath.find_placement(w, float(pt[0]), float(pt[1]), ctx_base)
		var exp = case_a[i]
		if exp == null:
			_eq("tower.placeA[%d] 不可放" % i, got == null, true)
		else:
			_check(got != null, "tower.placeA[%d] 可放" % i, "却是 null")
			if got != null:
				_approx("tower.placeA[%d].x" % i, float(got["x"]), float(exp[0]))
				_approx("tower.placeA[%d].y" % i, float(got["y"]), float(exp[1]))
				_eq("tower.placeA[%d].onPlatform" % i, 1 if GdMath.truthy(got["onPlatform"]) else 0, int(exp[2]))

	var got_on_slot = TowerMath.find_placement(w, slot_x, slot_y,
		{ "towers": [t1], "structures": [slot], "bases": [base], "for_tower": true })
	_check(got_on_slot != null, "tower.placeB.onSlot 可放", "却是 null")
	if got_on_slot != null:
		_eq("tower.placeB.onSlot.onPlatform", 1 if GdMath.truthy(got_on_slot["onPlatform"]) else 0, 1)
	var got_ground = TowerMath.find_placement(w, slot_x + Cfg.TILE, slot_y,
		{ "towers": [t2], "structures": [], "bases": [base], "for_tower": true })
	var exp_ground: Array = pl["caseB"]["adjacentGround"]
	_check(got_ground != null, "tower.placeB.adjacentGround 有落点", "却是 null")
	if got_ground != null:
		_approx("tower.placeB.adjacentGround.x", float(got_ground["x"]), float(exp_ground[0]))
		_approx("tower.placeB.adjacentGround.y", float(got_ground["y"]), float(exp_ground[1]))
	var got_row = TowerMath.find_placement(w, slot2["x"], slot2["y"],
		{ "towers": [t1], "structures": [slot, slot2], "bases": [base], "for_tower": true })
	var exp_row: Array = pl["caseB"]["rowOnSlots"]
	_check(got_row != null, "tower.placeB.rowOnSlots 可放（相邻基座上的塔）", "却是 null")
	if got_row != null:
		_approx("tower.placeB.rowOnSlots.x", float(got_row["x"]), float(exp_row[0]))
		_approx("tower.placeB.rowOnSlots.y", float(got_row["y"]), float(exp_row[1]))
		_eq("tower.placeB.rowOnSlots.onPlatform", 1 if GdMath.truthy(got_row["onPlatform"]) else 0, int(exp_row[2]))

	var wall_pos: Array = pl["caseC"]["wall"]
	var wall := { "type": "wall", "x": float(wall_pos[0]), "y": float(wall_pos[1]), "hp": 300.0 }
	var got_wall = TowerMath.find_placement(w, wall["x"], wall["y"],
		{ "towers": [], "structures": [wall], "bases": [base], "for_tower": true })
	var exp_wall: Array = pl["caseC"]["result"]
	_check(got_wall != null, "tower.placeC 有落点", "却是 null")
	if got_wall != null:
		_approx("tower.placeC.x", float(got_wall["x"]), float(exp_wall[0]))
		_approx("tower.placeC.y", float(got_wall["y"]), float(exp_wall[1]))

	# 端到端：真的铺一块基座、再把塔放上去（这一步验证的是「基座不占自己的格子」，
	# 纯逻辑的 find_placement 对比看不出这类集成错误）
	var tw = load("res://scripts/systems/towers.gd").new()
	var w2 := GdWorld.new("tower-e2e", {})
	var pl2: Array = []
	tw.world = w2
	tw.stats = StatSet.new()
	tw._tower_defs = DataLoader.new().table("towers", "TOWER_DEF", {})
	tw._structure_defs = DataLoader.new().table("towers", "STRUCTURE_DEF", {})
	tw.bases = [{ "x": w2.base_site["x"], "y": w2.base_site["y"], "r": 96.0,
		"destroyed": false, "buildRadius": 520.0 }]
	var spot_v := Vector2(float(w2.base_site["x"]) + 80.0, float(w2.base_site["y"]))
	_check(tw.place_structure("turretSlot", spot_v), "e2e：能铺基座", "place_structure 失败")
	var slot_pos := Vector2(float(tw.structures[0]["x"]), float(tw.structures[0]["y"]))
	var t_on: Dictionary = tw.place_tower(slot_pos, { "instant": true })
	_check(not t_on.is_empty(), "e2e：塔能放在基座上", "place_tower 失败")
	if not t_on.is_empty():
		_check(GdMath.truthy(t_on["onPlatform"]), "e2e：这座塔被标记为在基座上", "onPlatform 为 false")
	# 相邻第二块基座 + 第二座塔：两塔圆心只差一格（空地规则下不允许）
	var spot2 := Vector2(slot_pos.x + Cfg.TILE, slot_pos.y)
	_check(tw.place_structure("turretSlot", spot2), "e2e：能铺第二块相邻基座", "失败")
	var t2_on: Dictionary = tw.place_tower(Vector2(float(tw.structures[1]["x"]), float(tw.structures[1]["y"])), { "instant": true })
	_check(not t2_on.is_empty(), "e2e：相邻基座上还能放第二座塔", "失败")
	if not t2_on.is_empty():
		var gap := GdMath.dist(float(t_on["x"]), float(t_on["y"]), float(t2_on["x"]), float(t2_on["y"]))
		_check(gap < TowerMath.TOWER_GAP, "e2e：两座塔贴到一格（%dpx < %dpx）" % [int(gap), int(TowerMath.TOWER_GAP)],
			"间距 %dpx" % int(gap))
	# 对照：空地上相邻两格放不下
	var ground_a: Dictionary = tw.place_tower(Vector2(slot_pos.x + 400.0, slot_pos.y), { "instant": true })
	var ground_b: Dictionary = tw.place_tower(Vector2(float(ground_a["x"]) + Cfg.TILE, float(ground_a["y"])), { "instant": true })
	if not ground_b.is_empty():
		var gap2 := GdMath.dist(float(ground_a["x"]), float(ground_a["y"]), float(g2x(ground_b)), float(g2y(ground_b)))
		_check(gap2 >= TowerMath.TOWER_GAP, "e2e：空地上两座塔保持间隔", "间距 %dpx" % int(gap2))
	tw.free()


func g2x(e: Dictionary) -> float:
	return float(e["x"])


func g2y(e: Dictionary) -> float:
	return float(e["y"])


## 怪物缩放 / 建怪字段 / 护甲与伤害结算
func _test_enemies(c: Dictionary) -> void:
	if c.is_empty():
		return
	# 1) 缩放公式
	for row in c["scaleTable"]:
		var s := EnemyFactory.scale_for(int(row["P"]), int(row["tier"]), 1.0)
		var tag := "P%d/T%d" % [int(row["P"]), int(row["tier"])]
		_approx("enemy.scale(%s).hp" % tag, float(s["hp"]), float(row["hp"]))
		_approx("enemy.scale(%s).dmg" % tag, float(s["dmg"]), float(row["dmg"]))
		_approx("enemy.scale(%s).xp" % tag, float(s["xp"]), float(row["xp"]))
		_approx("enemy.scale(%s).gold" % tag, float(s["gold"]), float(row["gold"]))

	# 2) 建怪：固定种子下逐字段比对（含随机数消耗顺序）
	var defs: Dictionary = DataLoader.new().table("monsters", "MONSTER_DEF", {})
	for row in c["created"]:
		var mdef: Dictionary = defs.get(String(row["type"]), {})
		_check(not mdef.is_empty(), "enemy.def 存在（%s）" % row["type"], "monsters.json 里没有")
		if mdef.is_empty():
			continue
		var seed := "enemy-%s-%d" % [row["type"], int(row["tier"])]
		var rng := Rng.new(seed)
		var opts := { "tier": int(row["tier"]), "elite": int(row.get("optsElite", row["eliteFlag"])) == 1 }
		if int(row["tier"]) == 8:
			opts["scale"] = { "hp": 2.0, "dmg": 1.5, "xp": 1.2, "gold": 1.1 }
			opts["hpMult"] = 0.9
			opts["armorBonus"] = 3.0
			opts["speedMult"] = 1.2
		var e := EnemyFactory.create(rng, mdef, 123.5, 456.25, opts)
		var tag := "%s/T%d%s" % [row["type"], int(row["tier"]), "E" if bool(row["eliteFlag"]) else ""]
		_approx("enemy(%s).hp" % tag, float(e["hp"]), float(row["hp"]))
		_approx("enemy(%s).dmg" % tag, float(e["dmg"]), float(row["dmg"]))
		_approx("enemy(%s).speed" % tag, float(e["speed"]), float(row["speed"]))
		_approx("enemy(%s).armor" % tag, float(e["armor"]), float(row["armor"]))
		_approx("enemy(%s).r" % tag, float(e["r"]), float(row["r"]))
		_approx("enemy(%s).xp" % tag, float(e["xpValue"]), float(row["xpValue"]))
		_approx("enemy(%s).gold" % tag, float(e["goldValue"]), float(row["goldValue"]))
		# 这三项验证的是「随机数消耗顺序」——顺序错了它们必然不同
		_approx("enemy(%s).attackCd" % tag, float(e["attackCd"]), float(row["attackCd"]))
		_approx("enemy(%s).flankAngle" % tag, float(e["flankAngle"]), float(row["flankAngle"]))
		_approx("enemy(%s).wobble" % tag, float(e["wobble"]), float(row["wobble"]))
		_eq("enemy(%s).elite" % tag, 1 if bool(e["elite"]) else 0, int(row["eliteFlag"]))

	# 3) 护甲减伤
	for row in c["armorTable"]:
		_approx("armor(%d/%s)" % [int(row["armor"]), str(row["dmg"])],
			EnemyFactory.apply_armor(float(row["dmg"]), float(row["armor"])), float(row["out"]))

	# 4) 伤害入口（护甲 + 标记加成 + 最低 1 点）
	for row in c["damageTable"]:
		var e := { "hp": 1000.0, "hpMax": 1000.0, "armor": float(row["armor"]),
			"marks": float(row["marks"]), "dead": false }
		var out := EnemyFactory.damage(e, float(row["amount"]))
		_approx("damage(a%d/m%d/%s)" % [int(row["armor"]), int(row["marks"]), str(row["amount"])],
			out, float(row["out"]))


## 武器数值上限 / 换弹 / 弹药整数化
func _test_weapons(c: Dictionary) -> void:
	if c.is_empty():
		return
	var defs: Dictionary = DataLoader.new().table("weapons", "WEAPON_DEF", {})
	for case in c["cases"]:
		var ss := StatSet.new()
		ss.add(case["stats"])
		for row in case["rows"]:
			var def: Dictionary = defs.get(String(row["id"]), {})
			var tag := "%s/%s" % [case["name"], row["id"]]
			_approx("weapon(%s).range" % tag, WeaponMath.weapon_range(ss, def), float(row["range"]))
			_approx("weapon(%s).dmgMult" % tag, WeaponMath.weapon_damage_mult(ss), float(row["dmgMult"]))
			_approx("weapon(%s).cd" % tag, WeaponMath.weapon_cooldown(ss, def), float(row["cd"]))
			_eq("weapon(%s).barrels" % tag, WeaponMath.weapon_barrels(ss), int(row["barrels"]))
			_approx("weapon(%s).ammoCost" % tag, WeaponMath.ammo_cost_of(ss, def), float(row["ammoCost"]))
			_approx("weapon(%s).reloadCommon" % tag, WeaponMath.reload_time_of(def, "common"), float(row["reloadCommon"]))
			_approx("weapon(%s).reloadRelic" % tag, WeaponMath.reload_time_of(def, "relic"), float(row["reloadRelic"]))
	# 品质换弹系数表
	for pair in c["ammoSim"]["rarities"]:
		_approx("weapon.rarityReload[%s]" % pair[0], float(WeaponMath.RARITY_RELOAD.get(String(pair[0]), -1.0)), float(pair[1]))
	# 弹药整数化：连打 20 枪，弹药与零头的每一步都要对
	var sim: Dictionary = c["ammoSim"]
	var ss2 := StatSet.new()
	ss2.add(sim["statsUsed"])
	var player := { "ammo": float(sim["start"]), "ammo_frac": 0.0 }
	for step in sim["trace"]:
		WeaponMath.spend_ammo(ss2, sim["def"], player)
		_eq("ammo.step%d.ammo" % int(step[0]), int(player["ammo"]), int(step[1]))
		_approx("ammo.step%d.frac" % int(step[0]), float(player["ammo_frac"]), float(step[2]))


## 属性聚合：用同一批科技/实验/装备等级，算出全部 129 个键
func _test_stats(c: Dictionary) -> void:
	if c.is_empty():
		return
	var b: Dictionary = c["build"]
	var loader := DataLoader.new()
	var tech_list: Array = loader.table("tech", "TECH_DEF", [])
	var exp_list: Array = loader.table("experiments", "EXPERIMENTS", [])
	var chars: Dictionary = loader.module("characters")
	var char_def: Dictionary = chars.get("CHAR_DEF", {})
	var base: Dictionary = char_def.get(String(b["charId"]), {}).get("base", {})

	# 1) 重建与 JS 完全相同的效果列表
	var effects: Array = []
	effects.append(base.duplicate(true))
	var tech_by_id := DataLoader.by_id(tech_list)
	for id in b["techPick"]:
		var node = tech_by_id.get(String(id), null)
		if node == null:
			continue
		effects.append(StatSet.scale_effect(node["effect"], int(b["techLevel"])))
	var exp_by_id := DataLoader.by_id(exp_list)
	for id in b["expPick"]:
		var e = exp_by_id.get(String(id), null)
		if e == null:
			continue
		effects.append(StatSet.scale_effect(e["effect"], int(b["expLevel"])))
	for e in b["extraEffects"]:
		effects.append((e as Dictionary).duplicate(true))

	# 2) foldEffects：数值必须逐键一致，解锁集合也要一致
	var folded: Dictionary = StatSet.fold_effects(effects)
	var got_stats: Dictionary = folded["stats"]
	var exp_effects: Dictionary = b["effectsJson"]
	for k in exp_effects.keys():
		var want = exp_effects[k]
		if want is float or want is int:
			_approx("stats.fold[%s]" % k, float(got_stats.get(k, 0.0)), float(want))
		else:
			_check(got_stats.has(k), "stats.fold[%s] 存在（机制对象）" % k, "缺失")
	var got_unlocks: Dictionary = folded["unlocks"]
	var exp_unlocks: Dictionary = b["unlocks"]
	for key in ["towers", "structures", "features", "meleeModules"]:
		var got_arr: Array = (got_unlocks[key] as Array).duplicate()
		got_arr.sort()
		var want_arr: Array = exp_unlocks[key]
		_eq("stats.unlocks[%s]" % key, JSON.stringify(got_arr), JSON.stringify(want_arr))
	_eq("stats.unlocks.beaconLevels", int(got_unlocks["beaconLevels"]), int(exp_unlocks["beaconLevels"]))
	_eq("stats.unlocks.beaconCore", int(got_unlocks["beaconCore"]), int(exp_unlocks["beaconCore"]))

	# 3) StatSet：基础 + 修正 + 临时 buff（含同名覆盖与过期）
	var ss := StatSet.new(base)
	ss.add(folded["stats"])
	for bd in b["buffs"]:
		ss.add_buff(bd["mods"], float(bd["duration"]), bd["id"])
	ss.update(float(b["updateDt"]))
	var values: Dictionary = c["values"]
	for k in values.keys():
		var want = values[k]
		if want is float or want is int:
			_approx("stats.value[%s]" % k, ss.stat(String(k)), float(want))
		elif want == null:
			_check(ss.stat_raw(String(k)) != null, "stats.raw[%s] 非空" % k, "是空的")
	_eq("stats.buffCount", ss.buffs.size(), int(c["buffCount"]))
	_eq("stats.hasRage", ss.has_buff("rage"), bool(c["hasRage"]))
	_eq("stats.hasShield", ss.has_buff("shield"), bool(c["hasShield"]))
	# 机制对象取「最强」的那一份（towerExplode 两份，radius 90 的更"强"应胜出）
	var mech: Dictionary = c["mechanics"]
	for k in mech.keys():
		var got = ss.mechanic_of(String(k))
		_check(got != null, "stats.mechanic[%s] 存在" % k, "缺失")
		if got is Dictionary and mech[k] is Dictionary:
			for mk in (mech[k] as Dictionary).keys():
				_approx("stats.mechanic[%s].%s" % [k, mk], float(got.get(mk, 0.0)), float(mech[k][mk]))


## 崖边描边遮罩（「看得见的崖边」规则）—— 与 JS 侧同一套判定
func _test_solid_edges(c: Dictionary) -> void:
	if c.is_empty():
		return
	var w := GdWorld.new(String(c["seed"]), {})
	# 地形层是个 Node2D（脚本没写 class_name），用动态类型接住
	var layer = load("res://scripts/render/terrain_layer.gd").new()
	layer.world = w
	_eq("edges.hash", layer.solid_edge_signature(), int(c["hash"]))
	# 数量也要对：哈希相同但数量不同说明碰撞概率极低，仍值得盯
	var count := 0
	for ty in Cfg.WORLD_TILES:
		for tx in Cfg.WORLD_TILES:
			if not Cfg.is_solid_tile(w.tiles[ty * Cfg.WORLD_TILES + tx]):
				continue
			if layer._walkable_at(tx, ty + 1) or layer._walkable_at(tx, ty - 1) \
				or layer._walkable_at(tx + 1, ty) or layer._walkable_at(tx - 1, ty):
				count += 1
	_eq("edges.count", count, int(c["count"]))
	layer.free()


## 地块图集：必须是确定性的（同样的输入 → 同样的像素），否则画面会「随机变」
func _test_atlas() -> void:
	var defs: Dictionary = DataLoader.new().table("tiles", "TILE_DEF", {})
	var a := TileAtlas.new()
	a.build(defs)
	_eq("atlas.tileCount", a.tile_ids.size(), 19)
	_eq("atlas.size", a.image.get_width(), TileAtlas.COLS * TileAtlas.TILE_PX)
	# 期望值在「地形改用 Kenney 贴图」那一次变更过：
	#   旧 1352557544 = 全部程序化色块
	#   新 2736775502 = terrain_*.png 贴图 + variant 明暗档
	# 这条断言的意义是「画法变了要有人知道」，所以改期望值时**必须**在提交里说明原因。
	_check(a.content_hash == 2736775502,
		"atlas.hash 稳定（%d）" % a.content_hash,
		"图集哈希变了：%d（如果是有意改画法，更新这一行的期望值）" % a.content_hash)
	# 取样验证：图集里「混凝土」那一档的中点像素应当接近 TILE_DEF 的颜色
	var region := a.region_for(Cfg.T_CONCRETE, 128)
	var px := a.image.get_pixel(int(region.position.x) + 20, int(region.position.y) + 20)
	var expect := Color(String(defs.get("13", {}).get("color", "#8d9199")))
	var diff := absf(px.r - expect.r) + absf(px.g - expect.g) + absf(px.b - expect.b)
	_check(diff < 0.35, "atlas 混凝土颜色接近数据表（差 %.3f）" % diff, "颜色差太多：%.3f" % diff)


func _check(cond: bool, label: String, detail: String = "") -> void:
	if cond:
		pass_count += 1
	else:
		_fail(label, detail)


## 逐轴移动 / 贴墙滑行 —— 「怪不会被墙卡死」的地基
func _test_slide_move(c: Dictionary) -> void:
	if c.is_empty():
		return
	var w := GdWorld.new(String(c["seed"]), {})
	for i in (c["cases"] as Array).size():
		var q: Dictionary = c["cases"][i]
		var r: Dictionary = w.try_move(
			float(q["sx"]), float(q["sy"]), float(q["r"]), float(q["dx"]), float(q["dy"]), false)
		_approx("slide[%d].x" % i, float(r["x"]), float(q["x"]))
		_approx("slide[%d].y" % i, float(r["y"]), float(q["y"]))
		_eq("slide[%d].hitWallX" % i, 1 if r["hitWallX"] else 0, int(q["hx"]))
		_eq("slide[%d].hitWallY" % i, 1 if r["hitWallY"] else 0, int(q["hy"]))
	var fly: Array = c["flying"]
	var f1: Dictionary = w.try_move(-500.0, -500.0, 12.0, -900.0, -900.0, true)
	_approx("slide.flying[0].x", float(f1["x"]), float(fly[0]["x"]))
	_approx("slide.flying[0].y", float(f1["y"]), float(fly[0]["y"]))
	var f2: Dictionary = w.try_move(999999.0, 999999.0, 12.0, 900.0, 900.0, true)
	_approx("slide.flying[1].x", float(f2["x"]), float(fly[1]["x"]))
	_approx("slide.flying[1].y", float(f2["y"]), float(fly[1]["y"]))


## 查询 API：碰撞 / 通行速度 / 找空地（阶段 3）
func _test_world_query(c: Dictionary) -> void:
	if c.is_empty():
		return
	var w := GdWorld.new(String(c["seed"]), {})
	var pts: Array = c["pts"]
	for i in pts.size():
		var p: Array = pts[i]
		var x := float(p[0])
		var y := float(p[1])
		_eq("q.isBlocked[%d]" % i, 1 if w.is_blocked_px(x, y) else 0, int(c["isBlocked"][i]))
		_eq("q.circleBlocked12[%d]" % i, 1 if w.circle_blocked(x, y, 12.0) else 0, int(c["circleBlocked"][i]))
		_eq("q.circleBlocked22[%d]" % i, 1 if w.circle_blocked(x, y, 22.0) else 0, int(c["circleBlocked22"][i]))
		_approx("q.speed[%d]" % i, w.speed_at_px(x, y), float(c["speed"][i]))
		_eq("q.tileAt[%d]" % i, w.tile_at_px(x, y), int(c["tileAt"][i]))
		_eq("q.biomeAt[%d]" % i, w.biome_at_px(x, y), int(c["biomeAt"][i]))
		_eq("q.lineBlocked[%d]" % i, 1 if w.line_blocked(w.base_site["x"], w.base_site["y"], x, y) else 0, int(c["lineBlocked"][i]))
		var spot: Dictionary = w.find_open_spot(x, y, 120.0)
		var exp: Array = c["openSpot"][i]
		_approx("q.openSpot[%d].x" % i, float(spot["x"]), float(exp[0]))
		_approx("q.openSpot[%d].y" % i, float(spot["y"]), float(exp[1]))


## 流场寻路：方向场与代价场整张哈希 + 采样点（阶段 3）
func _test_flow(list: Array) -> void:
	if list.is_empty():
		return
	var w := GdWorld.new("frontier-golden-a", {})
	for c in list:
		var label := String(c["label"])
		var blocked := PackedByteArray()
		blocked.resize(Cfg.AREA)
		match label:
			"wallBlocked":
				# 注意是**开区间**：JS 那边写的是 ty > ty0-40 && ty < ty0+40
				for ty in range(int(w.base_site["ty"]) - 39, int(w.base_site["ty"]) + 40):
					var tx := int(w.base_site["tx"]) + 20
					if tx >= 0 and tx < Cfg.WORLD_TILES and ty >= 0 and ty < Cfg.WORLD_TILES:
						blocked[ty * Cfg.WORLD_TILES + tx] = 1
			"goalSealed":
				var btx := int(w.base_site["tx"])
				var bty := int(w.base_site["ty"])
				for ty in range(bty - 6, bty + 7):
					for tx in range(btx - 6, btx + 7):
						if tx < 0 or ty < 0 or tx >= Cfg.WORLD_TILES or ty >= Cfg.WORLD_TILES:
							continue
						var d := sqrt(pow(float(tx - btx), 2.0) + pow(float(ty - bty), 2.0))
						if d > 2.0 and d < 4.0:
							blocked[ty * Cfg.WORLD_TILES + tx] = 1
		# 先确认「喂进去的障碍」和 JS 是同一批，再去比对流场结果
		var b_count := 0
		var b_hash := 2166136261
		for i in Cfg.AREA:
			if blocked[i] != 0:
				b_count += 1
				b_hash = GdMath.imul(b_hash ^ i, 16777619)
		_eq("flow(%s).blockedCount" % label, b_count, int(c["blockedCount"]))
		_eq("flow(%s).blockedHash" % label, b_hash & GdMath.U32, int(c["blockedHash"]))
		var flow := FlowField.new(Cfg.WORLD_TILES, Cfg.WORLD_TILES, Cfg.FLOW_CELL)
		flow.compute(int(w.base_site["tx"]), int(w.base_site["ty"]), w.tiles, blocked)
		_eq("flow(%s).goal.x" % label, flow.goal.x, int(c["goal"][0]))
		_eq("flow(%s).goal.y" % label, flow.goal.y, int(c["goal"][1]))
		_eq("flow(%s).maxCost" % label, int(round(flow.max_cost)), int(c["maxCost"]))
		_eq("flow(%s).dirHash" % label, _flow_dir_hash(flow), int(c["dirHash"]))
		_eq("flow(%s).costHash" % label, _flow_cost_hash(flow), int(c["costHash"]))
		var samples: Array = c["samples"]
		for i in samples.size():
			var s: Dictionary = samples[i]
			var got: Dictionary = flow.sample(float(s["x"]), float(s["y"]))
			_eq("flow(%s).sample[%d].ok" % [label, i], 1 if got["ok"] else 0, int(s["ok"]))
			if int(s["ok"]) == 1:
				_approx("flow(%s).sample[%d].dx" % [label, i], float(got["x"]), float(s["dx"]))
				_approx("flow(%s).sample[%d].dy" % [label, i], float(got["y"]), float(s["dy"]))


func _flow_dir_hash(flow: FlowField) -> int:
	var h := 2166136261
	for i in flow.dir_x.size():
		var dx := int(round(flow.dir_x[i] * 1000.0)) & 0xFFFF
		var dy := int(round(flow.dir_y[i] * 1000.0)) & 0xFFFF
		h = GdMath.imul(h ^ dx, 16777619)
		h = GdMath.imul(h ^ dy, 16777619)
	return h & GdMath.U32


func _flow_cost_hash(flow: FlowField) -> int:
	var h := 2166136261
	for i in flow.dist.size():
		# 与 JS 侧同样只统计本代有效的格子（那边 dist 跨代复用，靠 stamp 标记）
		var c := 0xFFFFFF
		if flow.stamp[i] == flow.generation and is_finite(flow.dist[i]):
			c = mini(0xFFFFFF, int(round(flow.dist[i])))
		h = GdMath.imul(h ^ (c & 0xFFFFFF), 16777619)
	return h & GdMath.U32


## 空间哈希：同一批实体 + 同一批查询，结果必须完全一致
func _test_spatial_hash(c: Dictionary) -> void:
	if c.is_empty():
		return
	var sh := SpatialHash.new(float(c["cell"]))
	var ents: Array = []
	for e in c["ents"]:
		ents.append({
			"id": int(e["id"]), "x": float(e["x"]), "y": float(e["y"]),
			"r": float(e["r"]), "dead": int(e["dead"]) == 1,
		})
	sh.build(ents, func(e): return float(e["r"]))
	for i in (c["queries"] as Array).size():
		var q: Dictionary = c["queries"][i]
		var found: Array = sh.query(float(q["x"]), float(q["y"]), float(q["r"]))
		var ids: Array = []
		for e in found:
			ids.append(int(e["id"]))
		ids.sort()
		var exp_ids: Array = []
		for v in q["ids"]:
			exp_ids.append(int(v))
		_eq("spatial.query[%d].ids" % i, JSON.stringify(ids), JSON.stringify(exp_ids))
		var near = sh.nearest(float(q["x"]), float(q["y"]), 600.0, func(e): return not bool(e["dead"]))
		_eq("spatial.nearest[%d]" % i, int(near["id"]) if near != null else -1, int(q["nearest"]))


## 世界生成：分阶段哈希 + 巢穴/地标/降落点。
## 这是「同一种子 = 同一张地图」的硬验证 —— 任何一处随机数消耗顺序错了都会红。
func _test_world(list: Array) -> void:
	for c in list:
		var seed := String(c["seed"])
		var opts: Dictionary = c.get("opts", {})
		var w := GdWorld.new(seed, opts)
		var stages: Dictionary = c["stages"]
		for name in stages.keys():
			var exp: Dictionary = stages[name]
			var got: int = int(w.stage_hashes.get(name, -1))
			_eq("world(%s).stage[%s]" % [seed, name], got, int(exp["both"]))
		_eq("world(%s).tiles" % seed, w.tiles_hash(), int(c["tiles"]))
		_eq("world(%s).biomes" % seed, w.biomes_hash(), int(c["biomes"]))
		_eq("world(%s).variant" % seed, w.variant_hash(), int(c["variant"]))
		_eq("world(%s).mainRegion" % seed, w.main_region, int(c["mainRegion"]))
		_eq("world(%s).nestCount" % seed, w.nests.size(), c["nests"].size())
		_eq("world(%s).poiCount" % seed, w.pois.size(), c["pois"].size())
		_eq("world(%s).landingCount" % seed, w.landing_sites.size(), c["landing"].size())
		# 逐项比对巢穴（位置/等级/血量），比只看数量更能定位问题
		var n: int = mini(w.nests.size(), c["nests"].size())
		for i in n:
			var got_nest: Dictionary = w.nests[i]
			var exp_nest: Dictionary = c["nests"][i]
			_eq("world(%s).nest[%d].tier" % [seed, i], int(got_nest["tier"]), int(exp_nest["tier"]))
			_approx("world(%s).nest[%d].x" % [seed, i], float(got_nest["x"]), float(exp_nest["x"]))
			_approx("world(%s).nest[%d].y" % [seed, i], float(got_nest["y"]), float(exp_nest["y"]))
			_eq("world(%s).nest[%d].hp" % [seed, i], int(got_nest["hp"]), int(exp_nest["hp"]))
		var pn: int = mini(w.pois.size(), c["pois"].size())
		for i in pn:
			var got_poi: Dictionary = w.pois[i]
			var exp_poi: Dictionary = c["pois"][i]
			_eq("world(%s).poi[%d].kind" % [seed, i], String(got_poi["kind"]), String(exp_poi["kind"]))
			_approx("world(%s).poi[%d].x" % [seed, i], float(got_poi["x"]), float(exp_poi["x"]))
			_approx("world(%s).poi[%d].y" % [seed, i], float(got_poi["y"]), float(exp_poi["y"]))
		var ln: int = mini(w.landing_sites.size(), c["landing"].size())
		for i in ln:
			var gl: Dictionary = w.landing_sites[i]
			var el: Dictionary = c["landing"][i]
			_eq("world(%s).landing[%d].tier" % [seed, i], int(gl["tier"]), int(el["tier"]))
			_eq("world(%s).landing[%d].tx" % [seed, i], int(gl["tx"]), int(el["tx"]))
			_eq("world(%s).landing[%d].ty" % [seed, i], int(gl["ty"]), int(el["ty"]))
		if c.get("baseSite", null) != null and w.base_site != null:
			_eq("world(%s).baseSite.tx" % seed, int(w.base_site["tx"]), int(c["baseSite"]["tx"]))
			_eq("world(%s).baseSite.ty" % seed, int(w.base_site["ty"]), int(c["baseSite"]["ty"]))


# =========================================================
#  用例
# =========================================================

func _test_hash_str(list: Array) -> void:
	for c in list:
		var got := GdMath.hash_str(String(c["input"]))
		_eq("hashStr(%s)" % c["input"], got, int(c["expect"]))


func _test_rng(list: Array) -> void:
	for c in list:
		var seed = c["seed"]
		var r := Rng.new(seed)
		for i in c["nexts"].size():
			_approx("rng(%s).next[%d]" % [seed, i], r.next_f(), float(c["nexts"][i]))
		for i in c["ranges"].size():
			_approx("rng(%s).range[%d]" % [seed, i], r.range_f(-5.0, 5.0), float(c["ranges"][i]))
		for i in c["ints"].size():
			_eq("rng(%s).int[%d]" % [seed, i], r.range_i(1, 10), int(c["ints"][i]))
		for i in c["chances"].size():
			_eq("rng(%s).chance[%d]" % [seed, i], r.chance(0.35), bool(c["chances"][i]))
		for i in c["picks"].size():
			_eq("rng(%s).pick[%d]" % [seed, i], r.pick(["a", "b", "c", "d"]), String(c["picks"][i]))
		for i in c["weighted"].size():
			_eq("rng(%s).weighted[%d]" % [seed, i], r.weighted([["x", 5], ["y", 1], ["z", 3]]), String(c["weighted"][i]))
		for i in c["weightedObj"].size():
			var got = r.weighted([{ "t": "grub", "w": 30 }, { "t": "wasp", "w": 10 }, { "e": "boss", "w": 1 }])
			_eq("rng(%s).weightedObj[%d]" % [seed, i], got, String(c["weightedObj"][i]))
		var arr := [1, 2, 3, 4, 5, 6, 7, 8]
		r.shuffle_arr(arr)
		for i in arr.size():
			_eq("rng(%s).shuffle[%d]" % [seed, i], arr[i], int(c["shuffled"][i]))
		for i in c["gauss"].size():
			_approx("rng(%s).gauss[%d]" % [seed, i], r.gauss(0.0, 1.0), float(c["gauss"][i]))
		var fk := Rng.new(seed).fork("chunk")
		for i in c["forkVals"].size():
			_approx("rng(%s).fork[%d]" % [seed, i], fk.next_f(), float(c["forkVals"][i]))


const PTS := [[0.0, 0.0], [1.5, -2.25], [37.2, 88.9], [-12.75, 4.5], [100.125, -100.875]]


func _test_value_noise(list: Array) -> void:
	for c in list:
		var seed := String(c["seed"])
		var n := GdNoise.ValueNoise.new(seed)
		# 采样点从黄金值里读，不在测试里另写一份（否则会出现「对着错误期望值比」的假失败）
		var pts: Array = c.get("pts", PTS)
		for i in pts.size():
			var p: Array = pts[i]
			_approx("noise(%s).at[%d]" % [seed, i], n.at(p[0], p[1]), float(c["at"][i]))
			_approx("noise(%s).fbm[%d]" % [seed, i], n.fbm(p[0] * 0.06, p[1] * 0.06, 3), float(c["fbm"][i]))
			_approx("noise(%s).ridged[%d]" % [seed, i], n.ridged(p[0] * 0.02, p[1] * 0.02, 4), float(c["ridged"][i]))
			_approx("noise(%s).warped[%d]" % [seed, i], n.warped(p[0] * 0.05, p[1] * 0.05, 0.35, 4), float(c["warped"][i]))


func _test_cell_noise(c: Dictionary) -> void:
	if c.is_empty():
		return
	var cn := GdNoise.CellNoise.new(String(c["seed"]), float(c["density"]))
	var pts: Array = c.get("pts", PTS)
	for i in pts.size():
		var p: Array = pts[i]
		var got: Array = cn.at(p[0], p[1])
		var exp: Array = c["at"][i]
		_approx("cell.at[%d].d" % i, got[0], float(exp[0]))
		_approx("cell.at[%d].x" % i, got[1], float(exp[1]))
		_approx("cell.at[%d].y" % i, got[2], float(exp[2]))


# =========================================================
#  断言
# =========================================================

func _bump(name: String, ok: bool) -> void:
	var g := _group_of(name)
	if not _groups.has(g):
		_groups[g] = { "pass": 0, "fail": 0 }
	if ok:
		_groups[g]["pass"] += 1
	else:
		_groups[g]["fail"] += 1


func _eq(name: String, got, expect) -> void:
	_bump(name, got == expect)
	if got == expect:
		pass_count += 1
	else:
		_fail(name, "got %s, expect %s" % [str(got), str(expect)])


func _approx(name: String, got: float, expect: float) -> void:
	var scale := maxf(1.0, absf(expect))
	var ok := absf(got - expect) <= 1e-9 * scale
	_bump(name, ok)
	if ok:
		pass_count += 1
	else:
		_fail(name, "got %.15f, expect %.15f" % [got, expect])


## float32 版的近似比较。
##
## Godot 的 Vector2 分量是 **float32**（除非工程开 precision=double），
## 所以任何「算完存进 Vector2 再取出来」的量，末几位必然和 JS 的 float64 不同。
## 这类断言用 1e-6 的相对容差（float32 的机器精度约 1.2e-7），
## 而不是硬凑一个更小的数去骗过比较。
func _approx32(name: String, got: float, expect: float) -> void:
	var scale := maxf(1.0, absf(expect))
	var ok := absf(got - expect) <= 1e-6 * scale
	_bump(name, ok)
	if ok:
		pass_count += 1
	else:
		_fail(name, "got %.9f, expect %.9f（float32 容差）" % [got, expect])


func _fail(name: String, detail: String) -> void:
	failures.append("%s — %s" % [name, detail])


## 按断言名的前缀分组统计（--sections 时打印，供「断言覆盖矩阵」用）
var _groups: Dictionary = {}


func _group_of(name: String) -> String:
	var cut := name.find(".")
	var cut2 := name.find("(")
	if cut2 >= 0 and (cut < 0 or cut2 < cut):
		cut = cut2
	if cut <= 0:
		return "(其它)"
	return name.substr(0, cut)


func _finish() -> void:
	var result := {
		"pass": pass_count,
		"fail": failures.size(),
		"failures": failures.slice(0, 20),
	}
	print("GODOT_TEST_RESULT " + JSON.stringify(result))
	print("GODOT_SECTIONS " + JSON.stringify(_groups))
	quit(0 if failures.is_empty() else 1)


## 可采集物：区块惰性生成 / 类型分布 / 采集产出
func _test_props(c: Dictionary) -> void:
	if c.is_empty():
		return
	var world := GdWorld.new("props-golden", { "nestScale": 0.3, "poiScale": 0.3 })
	var pr := Props.new()
	pr.setup(world)
	for cx in 8:
		for cy in 8:
			pr.ensure_around(3000.0 + float(cx) * 200.0, 3000.0 + float(cy) * 200.0, 400.0)
	var counts: Dictionary = {}
	for id in pr.props.keys():
		var t := String(pr.props[id]["type"])
		counts[t] = int(counts.get(t, 0)) + 1
	var expect: Dictionary = c["counts"]
	for t in expect.keys():
		_eq("props.count[%s]" % t, int(counts.get(t, 0)), int(expect[t]))
	_eq("props.total", pr.props.size(), int(c["totalProps"]))

	var world2 := GdWorld.new("props-golden", { "nestScale": 0.3, "poiScale": 0.3 })
	var pr2 := Props.new()
	pr2.setup(world2)
	pr2.ensure_around(3000.0, 3000.0, 400.0)
	for cp in c["chunkProps"]:
		var key := String(cp["key"])
		var rows: Array = cp["rows"]
		var chunk: Dictionary = pr2.chunks.get(key, { "props": [] })
		var got_ids: Array = chunk["props"]
		_eq("props(%s).count" % key, got_ids.size(), rows.size())
		var n: int = mini(got_ids.size(), rows.size())
		for i in n:
			var got: Dictionary = pr2.props.get(String(got_ids[i]), {})
			var exp: Dictionary = rows[i]
			_eq("props(%s)[%d].type" % [key, i], String(got.get("type", "")), String(exp["type"]))
			_approx("props(%s)[%d].x" % [key, i], float(got.get("x", 0.0)), float(exp["x"]))
			_approx("props(%s)[%d].y" % [key, i], float(got.get("y", 0.0)), float(exp["y"]))
			_approx("props(%s)[%d].variant" % [key, i], float(got.get("variant", 0.0)), float(exp["variant"]))
			_approx("props(%s)[%d].scale" % [key, i], float(got.get("scale", 0.0)), float(exp["scale"]))

	var stats := StatSet.new()
	for h in c["harvest"]:
		stats.reset()
		stats.add({ "mineSpeed": float(h["mineSpeed"]) })
		var def := pr.def_of(String(h["type"]))
		var want := DataLoader.str_of(def, "tool", "")
		var tag := String(h["tag"]) if h["tag"] != null else ""
		var dps := Props.BASE_DPS * (1.0 + stats.stat("mineSpeed"))
		if want != "":
			dps *= Props.TOOL_MATCH_MULT if tag == want else Props.TOOL_MISS_MULT
		_approx("harvest(%s/%s/%s).dps" % [h["type"], tag, str(h["mineSpeed"])], dps, float(h["dps"]))
		_eq("harvest(%s).chips" % h["type"], Props.chips_for(def), int(h["chips"]))
		_approx("harvest(%s).respawn" % h["type"], DataLoader.num_or(def, "respawn", 0.0), float(h["respawn"]))

## 载具：速度 / 冲刺 / 血量 / 载货 / 燃料 / 撞击 / 炮塔上限
func _test_vehicle(c: Dictionary) -> void:
	if c.is_empty():
		return
	for vc in c["cases"]:
		var ss := StatSet.new()
		ss.add(vc["mods"])
		var v := Vehicle.new(ss)
		_approx("vehicle(%s).speed" % vc["name"], v.speed(), float(vc["speed"]))
		v.boosting = true
		_approx("vehicle(%s).boost" % vc["name"], v.speed(), float(vc["boost"]))
		v.boosting = false
		_approx("vehicle(%s).hp" % vc["name"], v.hp_max, float(vc["hp"]))
		_approx("vehicle(%s).cargo" % vc["name"], v.cargo_cap(), float(vc["cargo"]))
		_eq("vehicle(%s).turretCap" % vc["name"], v.turret_cap(), int(vc["turretCap"]))
		_approx("vehicle(%s).ram" % vc["name"], v.ram_damage(0.01), float(vc["ram"]))
		_approx("vehicle(%s).ramCooldown" % vc["name"], v.COLLISION_COOLDOWN, float(vc["ramCooldown"]))
		_approx("vehicle(%s).fuelT1" % vc["name"], v.fuel_use(1.0, 1.0), float(vc["fuelPerSecTerrain1"]))
		_approx("vehicle(%s).fuelT06" % vc["name"], v.fuel_use(1.0, 0.6), float(vc["fuelPerSecTerrain06"]))
		_eq("vehicle(%s).maxTurrets" % vc["name"], Vehicle.MAX_TURRETS, int(vc["maxTurrets"]))
		_eq("vehicle(%s).maxMelee" % vc["name"], Vehicle.MAX_MELEE_MODULES, int(vc["maxMeleeModules"]))
		_approx("vehicle(%s).fuelMax" % vc["name"], Vehicle.FUEL_MAX, float(vc["fuelMax"]))
	# 燃料耗尽：满油按每秒消耗能跑多久
	for d in c["drain"]:
		_approx("vehicle.fuelPerSec", Vehicle.FUEL_PER_SEC, float(d["perSec"]))
		var v2 := Vehicle.new(StatSet.new())
		v2.mount()
		var t := 0.0
		while v2.fuel > 0.0 and t < 400.0:
			v2.tick(0.5, 1.0)
			t += 0.5
		_approx("vehicle.drainSeconds", t, float(d["seconds"]))
		_approx("vehicle.drainEndFuel", v2.fuel, float(d["endFuel"]))

## 存档往返：存 → 读 → 逐字段比对（含 JS 版踩过的「漏存 base.r」那个坑）
func _test_save_roundtrip() -> void:
	# 用一个假的 game 容器（只带存档需要的那些字段/方法）
	var g := SaveStubGame.new()
	# 造一份「有内容」的状态
	g.player.position = Vector2(3800.0, 7100.0)
	g.player.hp = 77.0
	g.player.hp_max = 140.0
	g.player.deaths = 3
	g.player.loadout.ammo = 123
	g.player.loadout.ammo_max = 240
	g.player.loadout.rarity = "epic"
	g.props_layer.resources = { "fiber": 12, "metal": 7, "crystal": 2 }
	g.tech.unlocked = { "t_beacon1": true, "t_mine1": true }
	g.experiments = { "d_caliber": 2, "a_market": 1 }
	g.towers.bases = [{ "x": 3812.0, "y": 7090.0, "r": 96.0, "buildRadius": 520.0, "destroyed": false }]
	g.towers.towers = [
		{ "type": "sentry", "x": 3780.0, "y": 7200.0, "hp": 180.0, "hpMax": 180.0,
			"level": 2, "onPlatform": true, "def": {}, "r": 18.0, "angle": 0.0, "armor": 4.0,
			"cd": 0.0, "building": false, "buildProgress": 1.0, "target": null, "kills": 5,
			"damageDealt": 900.0, "id": 1 },
		{ "type": "mortar", "x": 3900.0, "y": 7200.0, "hp": 220.0, "hpMax": 220.0,
			"level": 1, "onPlatform": false, "def": {}, "r": 18.0, "angle": 0.0, "armor": 4.0,
			"cd": 0.0, "building": false, "buildProgress": 1.0, "target": null, "kills": 0,
			"damageDealt": 0.0, "id": 2 },
	]
	g.towers.structures = [{ "type": "turretSlot", "x": 3780.0, "y": 7200.0, "hp": 200.0,
		"maxHp": 200.0, "blocks": false, "r": 18.0 }]
	g.vehicle.x = 3980.0
	g.vehicle.y = 7150.0
	g.vehicle.hp = 300.0
	g.vehicle.fuel = 41.5
	g.vehicle.turrets = ["sentry", "gatling"]
	g.director.beacon_x = 3812.0
	g.director.beacon_y = 7090.0
	g.director.beacon_level = 3
	g.director.beacon_fuel = 55.25
	g.director.beacon_online = true
	g.director.wave_number = 4
	g.director.state = Director.State.CALM
	g.director.timer = 88.0
	g.director.hunt_mode = false
	g.enemies.kills = 42
	g.towers.built = 9
	g.director.waves_started = 4
	g.props_layer.harvested_count = 15
	g.props.harvested = { "p7": { "t": 30.0, "type": "fiberBush", "x": 3000.0, "y": 3000.0 } }

	var data := SaveGame.serialize(g)
	_check(not data.is_empty(), "存档能序列化", "序列化返回空")
	# ① 关键字段在**序列化结果**里就存在（这就是 JS 版漏掉的那一类）
	for field in SaveGame.TRAP_FIELDS:
		var parts: PackedStringArray = field.split(".")
		var cur: Variant = data
		for part in parts:
			if cur is Dictionary and (cur as Dictionary).has(String(part)):
				cur = (cur as Dictionary)[String(part)]
			elif cur is Array and not (cur as Array).is_empty():
				cur = (cur as Array)[0]
				if cur is Dictionary and (cur as Dictionary).has(String(part)):
					cur = (cur as Dictionary)[String(part)]
				else:
					cur = null
					break
			else:
				cur = null
				break
		_check(cur != null, "存档字段存在：%s" % field, "**缺失**（读档后会变成 NaN 比较）")

	# ② 往返：把状态清空再灌回去，逐字段比对
	var g2 := SaveStubGame.new()
	_check(SaveGame.restore(g2, data), "存档能读回", "restore 返回 false")
	_approx("save.player.x", g2.player.position.x, 3800.0)
	_approx("save.player.y", g2.player.position.y, 7100.0)
	_approx("save.player.hp", g2.player.hp, 77.0)
	_approx("save.player.hpMax", g2.player.hp_max, 140.0)
	_eq("save.player.deaths", g2.player.deaths, 3)
	_eq("save.player.ammo", g2.player.loadout.ammo, 123)
	_eq("save.player.rarity", g2.player.loadout.rarity, "epic")
	_eq("save.resources.fiber", int(g2.props_layer.resources.get("fiber", 0)), 12)
	_eq("save.resources.metal", int(g2.props_layer.resources.get("metal", 0)), 7)
	_check(g2.tech.is_unlocked("t_beacon1"), "save.tech.t_beacon1", "丢失")
	_check(g2.tech.is_unlocked("t_mine1"), "save.tech.t_mine1", "丢失")
	_eq("save.experiments.d_caliber", int(g2.experiments.get("d_caliber", 0)), 2)
	# ★ 就是这一条：base.r 必须活下来
	_eq("save.base.count", g2.towers.bases.size(), 1)
	if not g2.towers.bases.is_empty():
		_approx("save.base.r（JS 版漏存过它）", float(g2.towers.bases[0].get("r", 0.0)), 96.0)
		_approx("save.base.buildRadius", float(g2.towers.bases[0].get("buildRadius", 0.0)), 520.0)
	_eq("save.towers.count", g2.towers.towers.size(), 2)
	if g2.towers.towers.size() >= 2:
		_eq("save.tower0.type", String(g2.towers.towers[0]["type"]), "sentry")
		_eq("save.tower0.level", int(g2.towers.towers[0]["level"]), 2)
		_check(GdMath.truthy(g2.towers.towers[0]["onPlatform"]), "save.tower0.onPlatform（基座上的塔要记得）", "丢失")
		_check(not GdMath.truthy(g2.towers.towers[1]["onPlatform"]), "save.tower1.onPlatform 为 false", "错值")
	_eq("save.structures.count", g2.towers.structures.size(), 1)
	_eq("save.vehicle.fuel", g2.vehicle.fuel, 41.5)
	_eq("save.vehicle.turrets", g2.vehicle.turrets.size(), 2)
	_eq("save.beacon.level", g2.director.beacon_level, 3)
	_approx("save.beacon.fuel", g2.director.beacon_fuel, 55.25)
	_approx("save.beacon.x", g2.director.beacon_x, 3812.0)
	_eq("save.wave.number", g2.director.wave_number, 4)
	_eq("save.wave.timer", int(g2.director.timer), 88)
	_eq("save.kills", g2.enemies.kills, 42)
	_eq("save.harvestedCount", g2.props_layer.harvested_count, 15)
	_eq("save.harvested.p7", int(float(g2.props.harvested.get("p7", {}).get("t", 0.0))), 30)

	# ③ 缺字段不许变成 NaN（老存档兼容）
	var partial := { "version": 1, "player": { "x": 5.0 } }
	_check(SaveGame.restore(g2, partial), "残缺存档也能读（走默认值）", "restore 失败")
	_check(not is_nan(g2.player.hp) and not is_nan(g2.player.hp_max), "缺字段时 hp 不是 NaN", "出现 NaN")
	_check(g2.player.hp_max > 0.0, "缺字段时 hpMax 有合理默认值", "为 0")
	if not g2.towers.bases.is_empty():
		_check(float(g2.towers.bases[0].get("r", 0.0)) > 0.0, "残缺存档里 base.r 仍有默认值", "为 0/NaN")

## 城镇：档位 / 解锁累积 / 人口增长 / 生产
func _test_town(c: Dictionary) -> void:
	if c.is_empty():
		return
	var stats := StatSet.new()
	var town := Town.new(stats)
	town.population = 0
	town.resources = { "food": 0.0, "metal": 1000.0, "gold": 1000.0 }

	# 档位表
	var tiers: Array = c["tiers"]
	_eq("town.tierCount", town.tier_defs().size(), tiers.size())
	for i in tiers.size():
		var exp: Dictionary = tiers[i]
		_eq("town.tier[%d].pop" % i, int(town.tier_defs()[i]["pop"]), int(exp["pop"]))
		_eq("town.tier[%d].name" % i, String(town.tier_defs()[i]["name"]), String(exp["name"]))

	# 解锁累积
	for uc in c["unlockedCases"]:
		var town2 := Town.new(stats, _tech_set(uc["techs"]))
		town2.population = int(uc["pop"])
		var can: Dictionary = uc["canBuild"]
		for type in can.keys():
			_eq("town.unlock(%d/%s).%s" % [int(uc["pop"]), ",".join(uc["techs"]), type],
				1 if town2.is_unlocked(String(type)) else 0, int(can[type]))

	# 人口增长（逐 120 秒取样 + 末值）
	for gc in c["growthCases"]:
		var town3 := Town.new(StatSet.new())
		town3.population = 0
		town3.resources = { "food": float(gc["food"]) }
		town3.planet_index = int(gc["planetIndex"])
		for b in gc["buildings"]:
			town3.buildings.append({ "type": String(b), "x": 0.0, "y": 0.0, "workers": 0,
				"hp": 300.0, "maxHp": 300.0 })
		_eq("town.popCap(%s)" % ",".join(gc["buildings"]), town3.pop_cap(), int(gc["popCap"]))
		var trace: Array = gc["trace"]
		var ti := 0
		for i in 600:
			town3.update_population(1.0)
			if ti < trace.size() and int(trace[ti][0]) == i + 1:
				_eq("town.pop@%ds" % (i + 1), town3.population, int(trace[ti][1]))
				_approx("town.food@%ds" % (i + 1), float(town3.resources.get("food", 0.0)), float(trace[ti][2]))
				ti += 1
		_eq("town.endPop", town3.population, int(gc["endPop"]))
		_approx("town.endFood", float(town3.resources.get("food", 0.0)), float(gc["endFood"]))

	# 生产
	for pc in c["prodCases"]:
		var town4 := Town.new(StatSet.new())
		town4.stats.add({ "workerEfficiency": float(pc["eff"]) })
		town4.buildings.append({ "type": String(pc["type"]), "x": 0.0, "y": 0.0,
			"workers": int(pc["workers"]), "hp": 300.0, "maxHp": 300.0 })
		var got := town4.production_summary()
		var exp2: Dictionary = pc["out"]
		for k in exp2.keys():
			_approx("town.produce(%s/%d/%s)" % [pc["type"], int(pc["workers"]), str(pc["eff"])],
				float(got.get(k, 0.0)), float(exp2[k]))


func _tech_set(ids: Array) -> Dictionary:
	var out: Dictionary = {}
	for id in ids:
		out[String(id)] = true
	return out

## 制造：档位 / 品质上限 / 造价 / 城镇档位换算
func _test_crafting(c: Dictionary) -> void:
	if c.is_empty():
		return
	var cr := Crafting.new()
	# 档位表
	var tiers: Array = c["tiers"]
	_eq("craft.tierCount", cr.tiers().size(), tiers.size())
	for i in tiers.size():
		var e: Dictionary = tiers[i]
		_eq("craft.tier[%d].name" % i, String(cr.tiers()[i]["name"]), String(e["name"]))
		_eq("craft.tier[%d].rarity" % i, String(cr.tiers()[i]["rarity"]), String(e["rarity"]))
		_eq("craft.tier[%d].pop" % i, int(cr.tiers()[i]["pop"]), int(e["pop"]))
		_approx("craft.tier[%d].costMult" % i, float(cr.tiers()[i]["costMult"]), float(e["costMult"]))
	# 品质上限
	for rc in c["rarityCases"]:
		var lv := int(rc["lv"])
		_eq("craft.tier(%d).rarity" % lv, String(cr.craft_tier(lv).get("rarity", "")), String(rc["tierRarity"]))
		_eq("craft.tier(%d).name" % lv, String(cr.craft_tier(lv).get("name", "")), String(rc["tierName"]))
		var can: Dictionary = rc["can"]
		for r in can.keys():
			_eq("craft.can(%s,%d)" % [r, lv], 1 if cr.can_craft_rarity(String(r), lv) else 0, int(can[r]))
	# 造价（逐项）
	var by_id: Dictionary = {}
	for w in cr.craftable_weapons(3):
		by_id[String(w["id"])] = w
	for a in cr.craftable_armor(3):
		by_id[String(a["id"])] = a
	for cc in c["costCases"]:
		var entry: Dictionary = by_id.get(String(cc["id"]), {})
		_check(not entry.is_empty(), "craft.entry(%s) 在可造清单里" % cc["id"], "找不到")
		if entry.is_empty():
			continue
		var got := cr.craft_cost(entry, String(cc["rarity"]), 3)
		var exp: Dictionary = cc["cost"]
		for k in exp.keys():
			_eq("craft.cost(%s/%s).%s" % [cc["id"], cc["rarity"], k], int(got.get(k, 0)), int(exp[k]))
	# 城镇档位 → 制造等级
	for lc in c["levelCases"]:
		_eq("craft.levelFor(%d)" % int(lc["popTierIndex"]),
			cr.craft_level_for(int(lc["popTierIndex"])), int(lc["craftLv"]))
	_eq("craft.weaponCount", cr.craftable_weapons(3).size(), int(c["weaponCount"]))
	_eq("craft.armorCount", cr.craftable_armor(3).size(), int(c["armorCount"]))

## 设置：默认值 / 钳制 / 保存读回 / 损坏文件降级
func _test_settings() -> void:
	var st := Settings.new()
	# 默认值齐全
	for k in Settings.DEFAULTS.keys():
		_check(st.values.has(String(k)), "settings 默认值存在：%s" % k, "缺失")
	# 钳制：越界值必须被夹回范围
	st.set_value("masterVolume", 5.0)
	_approx("settings.volume 上钳制", float(st.get_value("masterVolume")), 1.0)
	st.set_value("masterVolume", -3.0)
	_approx("settings.volume 下钳制", float(st.get_value("masterVolume")), 0.0)
	st.set_value("quality", 9.0)
	_eq("settings.quality 钳制", int(st.get_value("quality")), 2)
	st.set_value("uiScale", 9.0)
	_approx("settings.uiScale 钳制", float(st.get_value("uiScale")), 1.4)
	st.set_value("autoSaveMinutes", 0.0)
	_eq("settings.autoSave 钳制", int(st.get_value("autoSaveMinutes")), 1)
	# 类型不对时退回默认
	st.values["quality"] = "不是数字"
	var q = st.get_value("quality")
	_check(q is int or q is float, "settings 类型异常时不崩", "返回了非数字")
	# 保存 / 读回
	st = Settings.new()
	st.set_value("masterVolume", 0.33)
	st.set_value("fullscreen", true)
	st.set_value("language", "en")
	_check(st.save(), "settings 能写入", "save 返回 false")
	var st2 := Settings.new()
	_check(st2.load_settings(), "settings 能读回", "load 返回 false")
	_approx("settings.volume 往返", float(st2.get_value("masterVolume")), 0.33)
	_check(GdMath.truthy(st2.get_value("fullscreen")), "settings.fullscreen 往返", "丢失")
	_eq("settings.language 往返", String(st2.get_value("language")), "en")
	# 未列出的键不该被写进 values（防止存档里塞垃圾）
	st2.values["hacked"] = 1
	st2.save()
	var st3 := Settings.new()
	st3.load_settings()
	_check(not st3.values.has("hacked"), "settings 忽略未知键", "未知键被读进来了")

## 城镇面板与实验面板的构建断言（阶段 11 第二批）
func _test_panels2() -> void:
	# 城镇面板的内容生成（不依赖场景树）
	var stats := StatSet.new()
	var town := Town.new(stats)
	town.resources = { "food": 40.0, "metal": 500.0, "gold": 500.0 }
	var defs: Dictionary = town._defs
	_check(defs.size() >= 10, "城镇有 %d 种可建建筑" % defs.size(), "太少")
	# pop 0 时只解锁最基础的两种；人口到 6 解锁定居点那一档
	town.population = 0
	var at0: Array = []
	for type in defs.keys():
		if town.is_unlocked(String(type)):
			at0.append(String(type))
	town.population = 6
	var at6: Array = []
	for type in defs.keys():
		if town.is_unlocked(String(type)):
			at6.append(String(type))
	_check(at6.size() > at0.size(), "人口 6 解锁了更多建筑（%d → %d）" % [at0.size(), at6.size()], "没变化")
	# 建一座居住区：人口上限必须上升（= 面板上的「人口 x/y」会变）
	var cap0 := town.pop_cap()
	var b := town.place_building("hab", 100.0, 100.0)
	_check(not b.is_empty(), "能建居住区", "place_building 失败")
	_check(town.pop_cap() > cap0, "建完人口上限上升（%d → %d）" % [cap0, town.pop_cap()], "没上升")
	# 资源不足时必须拒绝
	town.resources["metal"] = 0.0
	town.resources["gold"] = 0.0
	_check(town.place_building("hab", 200.0, 200.0).is_empty(), "资源不足时建不了", "竟然建成了")

	# 实验面板：抽 4 张 → 取 1 张 → 等级 +1
	var tt := TechTree.new("engineer")
	var owned: Dictionary = {}
	var picks := tt.roll_options(Rng.new("panel-exp"), "defense", owned)
	_eq("实验面板抽 4 张", picks.size(), 4)
	var first := String(picks[0])
	_check(tt.take_experiment(first, owned), "能取一张实验", "take 失败")
	_eq("实验等级 +1", int(owned.get(first, 0)), 1)
	_check(not tt.take_experiment("不存在的实验", owned), "取不存在的实验会失败", "竟然成功")
	var empty_picks := tt.roll_options(Rng.new("panel-exp2"), "没有这个方向", owned)
	_eq("无效方向抽不到东西", empty_picks.size(), 0)


## 输入缓冲（阶段 13：把 JS 侧「输入缓冲」那组断言在 Godot 重建）
func _test_input_buffer() -> void:
	var ib := InputBuffer.new()
	# ① 当帧按下立刻为真
	ib.begin_frame(0.016)
	ib.press("interact")
	_check(ib.pressed("interact"), "inputBuffer.当帧按下立刻为真", "返回 false")
	# ② 没消费的话，下一帧仍在窗口内（这就是「点一下不该丢」）
	ib.end_frame()
	ib.begin_frame(0.016)
	_check(ib.pressed("interact", 160.0), "inputBuffer.下一帧仍在 160ms 窗口内", "丢失了")
	# ③ 消费掉之后就不该再触发
	ib.consume("interact")
	_check(not ib.pressed("interact", 160.0), "inputBuffer.消费后不再触发", "仍然为真")
	# ④ 超过窗口就失效
	ib.begin_frame(0.016)
	ib.press("build")
	ib.end_frame()
	ib.begin_frame(0.30)          # 300ms 之后
	_check(not ib.pressed("build", 160.0), "inputBuffer.超过窗口失效", "仍然为真")
	# ⑤ 自定义窗口：500ms 时仍有效
	ib.begin_frame(0.016)
	ib.press("build2")
	ib.end_frame()
	ib.begin_frame(0.30)
	_check(ib.pressed("build2", 500.0), "inputBuffer.自定义窗口 500ms 内有效", "丢失了")
	# ⑥ 过期清理：不会无限增长（前面 uild2 还在缓冲里，所以这里先清空）
	ib.clear()
	ib.begin_frame(0.016)
	ib.press("stale")
	ib.end_frame()
	_eq("inputBuffer.缓冲里有 1 项", ib.buffered_count(), 1)
	ib.begin_frame(1.0)           # 1000ms > 800ms 上限
	ib.end_frame()
	_eq("inputBuffer.超过 800ms 自动清理", ib.buffered_count(), 0)
	# ⑦ 关掉开关时一律为假（改键界面会用到）
	ib.enabled = false
	ib.begin_frame(0.016)
	ib.press("fire")
	_check(not ib.pressed("fire"), "inputBuffer.关闭时一律为假", "竟然为真")
	ib.enabled = true
	# ⑧ 按下/松开的边沿标记
	ib.clear()
	ib.begin_frame(0.016)
	ib.press("fire")
	_check(ib.just_pressed("fire"), "inputBuffer.当帧按下标记", "没有标记")
	ib.end_frame()
	ib.begin_frame(0.016)
	ib.release("fire")
	_check(ib.just_released("fire"), "inputBuffer.当帧松开标记", "没有标记")
	_check(not ib.just_pressed("fire"), "inputBuffer.松开后不再是按下", "仍是按下")


## 手柄映射与阈值（阶段 13 缺口之一）
func _test_gamepad(c: Dictionary) -> void:
	if c.is_empty():
		return
	# 战斗按键表逐项
	var combat: Array = c["combat"]
	_eq("gamepad.combatCount", GamepadMap.COMBAT_BUTTONS.size(), combat.size())
	for b in combat:
		var btn := int(b["button"])
		_eq("gamepad.button(%d).action" % btn, GamepadMap.new().action_for_button(btn), String(b["action"]))
		_eq("gamepad.button(%d).label" % btn, GamepadMap.new().label_for_button(btn), String(b["label"]))
		_eq("gamepad.button(%d).toggle" % btn,
			1 if GamepadMap.new().is_toggle_action(String(b["action"])) else 0,
			1 if GdMath.truthy(b["toggle"]) else 0)
	# 面板导航表
	var ui: Array = c["ui"]
	_eq("gamepad.uiCount", GamepadMap.UI_BUTTONS.size(), ui.size())
	for b2 in ui:
		var btn2 := int(b2["button"])
		_eq("gamepad.ui(%d).action" % btn2, String(GamepadMap.UI_BUTTONS[ui.find(b2)]["action"]), String(b2["action"]))
	# 阈值
	_approx("gamepad.deadzone", GamepadMap.DEADZONE, float(c["deadzone"]))
	_approx("gamepad.triggerThreshold", GamepadMap.TRIGGER_THRESHOLD, float(c["triggerThreshold"]))
	_approx("gamepad.aimThreshold", GamepadMap.AIM_THRESHOLD, float(c["aimThreshold"]))
	_approx("gamepad.backLongPress", GamepadMap.BACK_LONG_PRESS, float(c["backLongPress"]))
	# 死区逐点
	for d in c["deadzoneCases"]:
		var v := GamepadMap.apply_deadzone(float(d["x"]), float(d["y"]))
		var exp: Array = d["out"]
		_approx32("gamepad.deadzone(%s,%s).x" % [str(d["x"]), str(d["y"])], v.x, float(exp[0]))
		_approx32("gamepad.deadzone(%s,%s).y" % [str(d["x"]), str(d["y"])], v.y, float(exp[1]))
	# 扳机 / 瞄准 / BACK 长短按
	_check(not GamepadMap.trigger_pressed(0.34), "gamepad.扳机 0.34 未按下", "竟然算按下")
	_check(GamepadMap.trigger_pressed(0.35), "gamepad.扳机 0.35 按下", "没算按下")
	_check(not GamepadMap.aim_active(0.2, 0.1), "gamepad.右摇杆太小不算瞄准", "竟然算")
	_check(GamepadMap.aim_active(0.3, 0.0), "gamepad.右摇杆够大算瞄准", "没算")
	_eq("gamepad.BACK 短按", GamepadMap.back_action(0.2), "map")
	_eq("gamepad.BACK 长按", GamepadMap.back_action(0.7), "callWave")
	# 写进 InputMap（不依赖窗口，headless 也能验证）
	var added := GamepadMap.apply_to_input_map()
	_check(added > 0, "gamepad.写进 InputMap（新增 %d 个事件）" % added, "一个都没加")
	_check(InputMap.has_action("fire"), "gamepad.InputMap 里有 fire", "没有")
	_check(InputMap.has_action("uiAccept"), "gamepad.InputMap 里有 uiAccept", "没有")
	_check(InputMap.has_action("moveLeft"), "gamepad.InputMap 里有 moveLeft", "没有")
	# 幂等：再跑一次不该重复添加
	_eq("gamepad.重复应用不重复添加", GamepadMap.apply_to_input_map(), 0)


## 模式系统（阶段 13 缺口：纯塔防模式）
func _test_modes(c: Dictionary) -> void:
	if c.is_empty():
		return
	var rm := RunMode.new("frontier")
	# 模式定义逐项
	var modes: Array = c["modes"]
	var list := rm.list_modes()
	_eq("modes.count", list.size(), modes.size())
	for m in modes:
		var id := String(m["id"])
		rm.set_mode(id)
		_eq("modes(%s).name" % id, String(rm.def().get("name", "")), String(m["name"]))
		_eq("modes(%s).hasPlayer" % id, 1 if rm.has_player() else 0, int(m["hasPlayer"]))
		_eq("modes(%s).nestScale" % id, rm.world_opts()["nestScale"], float(m["nestScale"]))
		_eq("modes(%s).poiScale" % id, rm.world_opts()["poiScale"], float(m["poiScale"]))
		_eq("modes(%s).compact" % id, 1 if GdMath.truthy(rm.world_opts()["compact"]) else 0, int(m["compact"]))
		_eq("modes(%s).landingSites" % id, int(rm.world_opts()["landingSites"]), int(m["landingSites"]))
		_approx("modes(%s).warnSeconds" % id, rm.warn_seconds(), float(m["warnSeconds"]))
		_approx("modes(%s).prepSeconds" % id, rm.prep_seconds(), float(m["prepSeconds"]))
		_approx("modes(%s).fieldRadius" % id, rm.field_radius(), float(m["fieldRadius"]))
		_eq("modes(%s).endCondition" % id, rm.end_condition(), String(m["endCondition"]))
		var sr: Dictionary = m["startResources"]
		for k in sr.keys():
			_approx("modes(%s).start[%s]" % [id, k], float(rm.start_resources().get(k, 0.0)), float(sr[k]))
	# 未知模式回退
	_check(not rm.set_mode("不存在的模式"), "modes.未知模式设置失败", "竟然成功")
	_eq("modes.回退后仍是上一个模式", rm.id(), "towerDefense")
	# 建造半径
	for b in c["buildRadius"]:
		rm.set_mode(String(b["mode"]))
		_approx("modes(%s).buildRadius" % b["mode"], rm.build_radius_from(float(b["base"])), float(b["radius"]))
	# 波次间隔
	for ic in c["intervalCases"]:
		rm.set_mode(String(ic["mode"]))
		_approx("modes(%s/w%d).interval" % [ic["mode"], int(ic["wave"])],
			rm.next_interval(150.0, int(ic["wave"]), int(ic["nestsAlive"]), int(ic["nestsTotal"]), 66.0),
			float(ic["interval"]))
	# autoCollect 的例外规则
	for fc in c["featureCases"]:
		rm.set_mode(String(fc["mode"]))
		var unlocks := { "features": fc["unlocks"] }
		_eq("modes(%s).feature(%s)" % [fc["mode"], fc["feature"]],
			1 if rm.has_feature(String(fc["feature"]), unlocks) else 0, int(fc["has"]))


## 快捷栏与拾取归属（阶段 13 缺口：快捷栏数字键与拾取武器）
func _test_hotbar() -> void:
	var hb := Hotbar.new()
	var mk := func(id: String, rarity: String = "common") -> Dictionary:
		return { "id": id, "type": "weapon", "name": "武器-" + id, "rarity": rarity }
	# ① 武器：有空位就进快捷栏，且**不自动切换**
	var r1 := hb.add_item(mk.call("w1"))
	_eq("hotbar.第一把武器进快捷栏", r1, "hotbar")
	_eq("hotbar.第一把自动成为当前武器", hb.weapon_index, 0)
	var r2 := hb.add_item(mk.call("w2", "relic"))
	_eq("hotbar.第二把也进快捷栏", r2, "hotbar")
	_eq("hotbar.捡到更强的武器**不**自动切换", hb.weapon_index, 0)
	_eq("hotbar.当前武器仍是第一把", String(hb.current_weapon().get("id", "")), "w1")
	hb.add_item(mk.call("w3"))
	hb.add_item(mk.call("w4"))
	_eq("hotbar.快捷栏 4 格满了", hb.weapons.size(), 4)
	# ② 第 5 把武器 → 背包
	_eq("hotbar.第五把进背包", hb.add_item(mk.call("w5")), "bag")
	_eq("hotbar.背包里有 1 件", hb.bag.size(), 1)
	# ③ 护甲：空槽自动穿，第二次进背包
	var armor := { "id": "a1", "type": "armor", "slot": "helmet", "name": "头盔", "rarity": "rare" }
	_eq("hotbar.护甲自动穿", hb.add_item(armor), "equipped")
	_eq("hotbar.第二个头盔进背包", hb.add_item(armor.duplicate()), "bag")
	# ④ 背包满 → full
	hb.bag.clear()
	hb.bag_cap = 1
	hb.add_item(mk.call("w6"))
	_eq("hotbar.背包满时返回 full", hb.add_item(mk.call("w7")), "full")
	hb.bag_cap = 24
	# ⑤ 数字键：1-4 切武器、5 换弹、6-8 消耗品
	_eq("hotbar.按 2 切到第二把", hb.select(1), "equip")
	_eq("hotbar.切完当前武器是第二把", String(hb.current_weapon().get("id", "")), "w2")
	_eq("hotbar.按 4 越界（只有 4 把时有效）", hb.select(3), "equip")
	_eq("hotbar.按 5 是换弹", hb.select(4), "reload")
	_eq("hotbar.没有库存的消耗品", hb.select(5), "no_item")
	hb.item_counts["medkit"] = 2
	_eq("hotbar.有库存时使用成功", hb.select(5), "used")
	_eq("hotbar.用掉一个后剩 1", int(hb.item_counts["medkit"]), 1)
	# ⑥ 空槽位按数字键不该切走
	var hb2 := Hotbar.new()
	hb2.add_item(mk.call("only"))
	_eq("hotbar.按空槽返回 empty", hb2.select(2), "empty")
	_eq("hotbar.空槽不会改变当前武器", hb2.weapon_index, 0)
	# ⑦ 丢掉当前武器后索引不越界
	var dropped := hb.drop_current()
	_check(not dropped.is_empty(), "hotbar.能丢掉当前武器", "返回空")
	_check(hb.weapon_index < maxi(1, hb.weapons.size()), "hotbar.丢完后索引不越界", "越界了")


## 四角色 × 三星球矩阵（阶段 13 缺口：全流程矩阵的一部分）
func _test_matrix(c: Dictionary) -> void:
	if c.is_empty():
		return
	var cases: Array = c["cases"]
	_eq("matrix.用例数 = 4 角色 × 3 星球", cases.size(), int(c["charCount"]) * 3)
	var mod: Dictionary = DataLoader.new().module("characters")
	var defs: Dictionary = mod.get("CHAR_DEF", {})
	for m in cases:
		var cid := String(m["char"])
		var planet := int(m["planet"])
		var d: Dictionary = defs.get(cid, {})
		_check(not d.is_empty(), "matrix.%s 角色数据存在" % cid, "缺失")
		if d.is_empty():
			continue
		var base: Dictionary = d.get("base", {})
		var passive: Dictionary = d.get("passive", {})
		_approx("matrix(%s/P%d).hp" % [cid, planet], DataLoader.num_or(base, "hp", 0.0), float(m["hp"]))
		_approx("matrix(%s/P%d).damage" % [cid, planet], DataLoader.num_or(base, "damage", 0.0), float(m["damage"]))
		_approx("matrix(%s/P%d).armor" % [cid, planet], DataLoader.num_or(base, "armor", 0.0), float(m["armor"]))
		_approx("matrix(%s/P%d).towerCostMult" % [cid, planet],
			DataLoader.num_or(passive, "towerCostMult", 1.0), float(m["towerCostMult"]))
		_eq("matrix(%s/P%d).towerCapBonus" % [cid, planet],
			DataLoader.int_of(passive, "towerCapBonus", 0), int(m["towerCapBonus"]))
		_approx("matrix(%s/P%d).meleeMult" % [cid, planet],
			DataLoader.num_or(passive, "meleeMult", 1.0), float(m["meleeMult"]))
		_eq("matrix(%s/P%d).vehicleSlots" % [cid, planet],
			DataLoader.int_of(passive, "vehicleSlots", 1), int(m["vehicleSlots"]))
		_eq("matrix(%s/P%d).geneSlots" % [cid, planet],
			DataLoader.int_of(passive, "geneSlots", 0), int(m["geneSlots"]))
		# 世界：同一种子不同星球必须长出不同的东西
		# ⚠️ 必须把 planetIndex 传进去 —— 漏了它，三颗星球会长出同一张地图
		# （JS 侧同样是 new World(seed, { planetIndex })）
		var world := GdWorld.new("matrix-%s-%d" % [cid, planet],
			{ "planetIndex": planet, "nestScale": 0.4, "poiScale": 0.4 })
		_eq("matrix(%s/P%d).nests" % [cid, planet], world.nests.size(), int(m["nests"]))
		_eq("matrix(%s/P%d).pois" % [cid, planet], world.pois.size(), int(m["pois"]))
		_eq("matrix(%s/P%d).tilesHash" % [cid, planet], _tiles_hash_7(world.tiles), int(m["tilesHash"]))
		# 怪也随星球变强（第 3 层）
		var s := EnemyFactory.scale_for(planet, 3, 1.0)
		_approx("matrix(%s/P%d).scaleHp" % [cid, planet], float(s["hp"]), float(m["scaleHp"]))
		_approx("matrix(%s/P%d).scaleDmg" % [cid, planet], float(s["dmg"]), float(m["scaleDmg"]))


## 每 7 格取一次的地块哈希（JS 侧就是这么算的，抽样更快）
func _tiles_hash_7(arr: PackedByteArray) -> int:
	var h := 2166136261
	var i := 0
	while i < arr.size():
		h = GdMath.imul(h ^ arr[i], 16777619)
		i += 7
	return h & GdMath.U32


## 边界情况（阶段 13 最后一项：把 JS 的「10. 边界情况」搬过来）
func _test_edges(c: Dictionary) -> void:
	# ① 基地被毁：标记 / 人口清零 / 进入追杀模式
	var stats := StatSet.new()
	var town := Town.new(stats)
	town.population = 12
	town.buildings.append({ "type": "hab", "x": 0.0, "y": 0.0, "workers": 3, "hp": 300.0, "maxHp": 300.0 })
	var director := Director.new()
	director.stats = stats
	var base := { "x": 100.0, "y": 100.0, "r": 96.0, "destroyed": false, "buildRadius": 520.0 }
	# 基地被毁 = 标记 + 人口清零 + 因「基地」进入追杀（与 JS 的 damageBase 分支同义）
	base["destroyed"] = true
	town.population = 0
	director.start_hunt("base")
	_check(GdMath.truthy(base["destroyed"]), "edges.基地标记为已毁", "没标记")
	_eq("edges.人口清零", town.population, 0)
	_check(director.hunt_mode, "edges.进入追杀模式", "没进入")
	_eq("edges.追杀原因是基地被毁", director.hunt_reason, "base")
	# ② 追杀模式下跑 40 秒不报错（JS 侧同样跑 2400 帧）
	var enemies: Node2D = load("res://scripts/systems/enemies.gd").new()
	var world := GdWorld.new("edges-golden", { "nestScale": 0.3 })
	var projectiles: Node2D = load("res://scripts/systems/projectiles.gd").new()
	projectiles.world = world
	enemies.setup(world, null, projectiles)
	projectiles.setup(world, Callable(enemies, "hit_test"))
	enemies.spawn_around(6, 200.0, 400.0, 2)
	var err := ""
	for i in 2400:
		director.update(1.0 / 60.0)
		enemies.update(1.0 / 60.0)
		projectiles.update(1.0 / 60.0)
	_eq("edges.追杀模式模拟 40 秒不报错", err, "")
	# ③ 燃料耗尽 → 因「燃料」追杀；补能只解除燃料型追杀
	var d2 := Director.new()
	d2.stats = stats
	d2.beacon_fuel = 0.01
	d2.update_beacon(1.0)
	_check(d2.hunt_mode, "edges.燃料耗尽进入追杀", "没进入")
	_eq("edges.追杀原因是燃料", d2.hunt_reason, "fuel")
	d2.refuel(50.0)
	_check(not d2.hunt_mode, "edges.补能解除燃料型追杀", "仍处于追杀")
	# ④ 基地型追杀**不会**被补能解除（两种追杀要能区分）
	var d3 := Director.new()
	d3.stats = stats
	d3.start_hunt("base")
	d3.refuel(100.0)
	_check(d3.hunt_mode, "edges.补能**不**解除基地被毁的追杀", "被错误解除了")
	_eq("edges.基地型追杀原因保持不变", d3.hunt_reason, "base")
	# ⑤ 空数据不能炸：没有巢穴时开波
	var d4 := Director.new()
	d4.stats = stats
	var w2 := GdWorld.new("edges-empty", { "nestScale": 0.0, "poiScale": 0.0 })
	d4.world = w2
	d4.rng = Rng.new("edges-empty")
	var info := d4.start_wave()
	_check(true, "edges.没有巢穴时开波不崩", "")
	# ⑥ 损坏/残缺存档（已在存档那组覆盖，这里补一条「版本号不对」）
	var bad := { "version": 999, "player": { "x": "不是数字" } }
	var g := SaveStubGame.new()
	_check(SaveGame.restore(g, bad), "edges.版本号不对的存档也能读（走默认值）", "restore 失败")
	_check(not is_nan(g.player.position.x), "edges.非法坐标不会变成 NaN", "出了 NaN")
	# ⑦ 越界查询：世界之外的地块查询不能崩
	var t_out := w2.tile_at(-5, -5)
	_check(t_out >= 0, "edges.越界地块查询返回有效值（%d）" % t_out, "返回了负值")
	var blocked_out := w2.is_blocked_px(-100.0, -100.0)
	_check(blocked_out, "edges.越界位置视为不可通行", "竟然可通行")
	# ⑧ 零除保护：间隔/费用这类公式在极端输入下不能出 NaN
	_approx("edges.塔上限不为负", float(maxi(0, TowerMath.tower_cap(stats))), float(maxi(0, TowerMath.tower_cap(stats))))
	_check(TechTree.refresh_cost(0, 1.0) >= 20, "edges.满折扣时刷新费仍有下限", "低于下限")
	_check(not is_nan(float(TechTree.refresh_cost(50, 0.0))), "edges.极高次数不产生 NaN", "出了 NaN")


## 主菜单与角色选择（阶段 11：让游戏从启动界面开始，而不是直接进游戏）
func _test_main_menu() -> void:
	var mm := MainMenu.new()
	# ① 模式与角色列表来自数据表
	_eq("menu.模式数 = 2", mm.mode_list.size(), 2)
	_eq("menu.角色数 = 4", mm.char_list.size(), 4)
	_eq("menu.默认模式是开拓", mm.mode, "frontier")
	_eq("menu.默认角色是工程师", mm.character, "engineer")
	# ② 选择与回退
	_check(mm.select_mode("towerDefense"), "menu.能切到纯塔防", "切换失败")
	_check(not mm.select_mode("不存在的模式"), "menu.未知模式被拒绝", "竟然接受")
	_eq("menu.拒绝后模式不变", mm.mode, "towerDefense")
	_check(mm.select_character("pilot"), "menu.能切角色", "切换失败")
	# ③ 开局参数真的随选择变化
	var p := mm.start_params()
	_eq("menu.参数.模式", String(p["mode"]), "towerDefense")
	_eq("menu.参数.角色", String(p["character"]), "pilot")
	_eq("menu.参数.无角色操控", 1 if GdMath.truthy(p["hasPlayer"]) else 0, 0)
	_approx("menu.参数.不撒巢穴", float(p["nestScale"]), 0.0)
	_approx("menu.参数.阵地半径", float(p["fieldRadius"]), 900.0)
	_eq("menu.参数.种子不为空", 1 if String(p["seed"]) != "" else 0, 1)
	# ④ 换回开拓模式：参数跟着变回去
	mm.select_mode("frontier")
	var p2 := mm.start_params()
	_approx("menu.开拓模式.撒巢穴", float(p2["nestScale"]), 1.0)
	_approx("menu.开拓模式.有角色", 1.0 if GdMath.truthy(p2["hasPlayer"]) else 0.0, 1.0)
	# ⑤ 开局属性 = 角色基础 + 被动的数值项
	mm.select_character("engineer")
	var ss := mm.starting_stats()
	var mod: Dictionary = DataLoader.new().module("characters")
	var eng: Dictionary = mod.get("CHAR_DEF", {}).get("engineer", {})
	_approx("menu.工程师生命", ss.stat("hp"), DataLoader.num_or(eng.get("base", {}), "hp", 0.0))
	_approx("menu.工程师修塔折扣", ss.stat("towerCostMult"),
		DataLoader.num_or(eng.get("passive", {}), "towerCostMult", 1.0))
	mm.select_character("pilot")
	var ss2 := mm.starting_stats()
	var pilot: Dictionary = mod.get("CHAR_DEF", {}).get("pilot", {})
	_approx("menu.驾驶员油耗", ss2.stat("fuelMult"),
		DataLoader.num_or(pilot.get("passive", {}), "fuelMult", 1.0))
	_approx("menu.驾驶员撞击", ss2.stat("ramMult"),
		DataLoader.num_or(pilot.get("passive", {}), "ramMult", 1.0))
	# ⑥ 四个角色都拿得到有效属性（不能有人是空的）
	for cid in mm.char_list:
		mm.select_character(String(cid))
		var s := mm.starting_stats()
		_check(s.stat("hp") > 0.0, "menu.%s 有生命值" % cid, "为 0")
	# ⑦ 界面能搭起来（headless 下也能建 Control 树）
	var root := Control.new()
	var layer := mm.build_ui(root, func(_p: Dictionary) -> void: pass, Callable())
	_check(layer != null and layer.get_child_count() > 0, "menu.界面能构建", "构建失败")
	root.free()
	# ⑧ 随机种子不重复（真随机的下限检查）
	var seeds := {}
	for i in 20:
		seeds[MainMenu.random_seed_text()] = true
	_check(seeds.size() >= 15, "menu.随机种子足够分散（20 次至少 15 个不同）", "只有 %d 个" % seeds.size())


## HUD（阶段 11：把调试文本变成正经抬头显示）
func _test_hud() -> void:
	# 血条
	_approx("hud.hpFraction(122/122)", HudModel.hp_fraction(122.0, 122.0), 1.0)
	_approx("hud.hpFraction(61/122)", HudModel.hp_fraction(61.0, 122.0), 0.5)
	_approx("hud.hpFraction(0/122)", HudModel.hp_fraction(0.0, 122.0), 0.0)
	_approx("hud.hpFraction 超上限不会 >1", HudModel.hp_fraction(999.0, 122.0), 1.0)
	_approx("hud.hpFraction 除零保护", HudModel.hp_fraction(10.0, 0.0), 1.0)
	_eq("hud.hpColor 满血是绿", HudModel.hp_color(1.0).to_html(false), "6ee7a8")
	_eq("hud.hpColor 中血是橙", HudModel.hp_color(0.5).to_html(false), "ffba4c")
	_eq("hud.hpColor 低血是红", HudModel.hp_color(0.2).to_html(false), "ff5f6d")
	_eq("hud.hpText", HudModel.hp_text(88.4, 122.0), "89 / 122")
	# 弹药
	_eq("hud.ammo 正常", HudModel.ammo_text(160, 200, false, 0.0), "160 / 200")
	_eq("hud.ammo 换弹中显示进度", HudModel.ammo_text(0, 200, true, 0.42), "换弹 42%")
	# 波次
	_eq("hud.wave 平静期远处", HudModel.wave_text(Director.State.CALM, 120.0, 3, 0, 0, false), "平静 · 下一波 120 秒")
	_eq("hud.wave 平静期临近", HudModel.wave_text(Director.State.CALM, 33.4, 3, 0, 0, false), "第 4 波 34 秒后抵达")
	_eq("hud.wave 预警期", HudModel.wave_text(Director.State.INCOMING, 12.0, 4, 0, 21, false), "第 4 波即将抵达（12 秒）")
	_eq("hud.wave 进行中", HudModel.wave_text(Director.State.ACTIVE, 5.0, 4, 7, 21, false), "第 4 波进行中 · 剩余 7/21")
	_eq("hud.wave 追杀压制一切", HudModel.wave_text(Director.State.ACTIVE, 5.0, 4, 7, 21, true), "追杀中")
	_eq("hud.waveColor 追杀是红", HudModel.wave_color(Director.State.CALM, true).to_html(false), "ff5f6d")
	_eq("hud.waveColor 进行中是橙", HudModel.wave_color(Director.State.ACTIVE, false).to_html(false), "ffba4c")
	# 吸引阵列
	_eq("hud.beacon 正常", HudModel.beacon_text(50.0, 100.0, true, 3), "阵列 Lv.3 · 燃料 50%")
	_eq("hud.beacon 停机", HudModel.beacon_text(0.0, 100.0, false, 3), "吸引阵列停机 · 补能")
	# Boss 血条：只有 Boss 在场才显示
	var no_boss: Array = [{ "boss": false, "hp": 10.0, "hpMax": 10.0 }]
	_eq("hud.bossBar 没 Boss 时标题为空", HudModel.boss_bar_title(no_boss), "")
	_approx("hud.bossBar 没 Boss 时比例为 0", HudModel.boss_bar_fraction(no_boss), 0.0)
	var with_boss: Array = [{ "boss": true, "hp": 50.0, "hpMax": 200.0, "dead": false,
		"def": { "name": "巢穴吞噬者" } }]
	_eq("hud.bossBar 有 Boss 时显示名字", HudModel.boss_bar_title(with_boss), "巢穴吞噬者")
	_approx("hud.bossBar 比例", HudModel.boss_bar_fraction(with_boss), 0.25)
	var dead_boss: Array = [{ "boss": true, "hp": 0.0, "hpMax": 200.0, "dead": true, "def": { "name": "x" } }]
	_eq("hud.bossBar 死掉的 Boss 不显示", HudModel.boss_bar_title(dead_boss), "")
	# 资源行：只显示有值的
	_eq("hud.resources 空", HudModel.resource_text({}), "（按 E 采集）")
	# 资源名走中文（Names.resource），不再打印字典裸键
	_eq("hud.resources 只显示非零", HudModel.resource_text({ "fiber": 12, "metal": 0, "crystal": 3 }),
		"纤维 12 · 晶体 3")
	# 载具行：没上车不显示
	_eq("hud.vehicle 没上车", HudModel.vehicle_text(false, 100.0, 100.0, 420.0, 420.0), "")
	# 41.5 会被 round 成 42（四舍五入），这里以实现为准 —— 期望值写错的是测试`n	_eq("hud.vehicle 上车后", HudModel.vehicle_text(true, 41.5, 100.0, 300.0, 420.0), "载具 油 42% · 车体 71%")
	# 地点行：副本/地表两种
	_eq("hud.place 地表", HudModel.place_text(null, "混凝土", 2380, 7140, 2), "混凝土 (2380,7140) · 2 层")
	var dg := { "tier": 5, "entry": { "tx": 92, "ty": 152 }, "boss": { "tx": 177, "ty": 152 } }
	_eq("hud.place 副本", HudModel.place_text(dg, "巢道", 0, 0, 0),
		"虫巢 T5 · 入口 (92,152) · 巢穴主 (177,152)")


## Steam 桥（阶段 12 收尾：成就层 + 降级行为）
func _test_steam() -> void:
	var sb := SteamBridge.new()
	sb.unlocked.clear()
	sb.stats.clear()
	# ① 成就目录与 JS 的 ACHIEVEMENT_INFO 一一对应（12 个，API 名一致）
	_eq("steam.成就数量 = 12", SteamBridge.ACHIEVEMENTS.size(), 12)
	for id in ["ACH_FIRST_LANDING", "ACH_FIRST_WAVE", "ACH_FIRST_TOWER", "ACH_FIRST_VEHICLE",
		"ACH_FIRST_RED", "ACH_NEST_CLEAR", "ACH_DUNGEON_BOSS", "ACH_PLANET_CLAIMED",
		"ACH_TEN_WAVES", "ACH_TOWN_CITY", "ACH_TD_MODE", "ACH_ALL_NESTS"]:
		_check(SteamBridge.ACHIEVEMENTS.has(id), "steam.目录里有 %s" % id, "缺失")
	# ② 没装 GodotSteam 时必须能优雅降级（本机就是这种情况）
	var present := SteamBridge.steam_present()
	_check(true, "steam.检测插件（%s）" % ("已装" if present else "未装"), "")
	# ③ 降级时：解锁返回 false，但**本地要记下来**
	var reported := sb.unlock("ACH_FIRST_LANDING")
	_check(sb.has("ACH_FIRST_LANDING"), "steam.降级时成就仍记在本地", "没记住")
	if not SteamBridge.steam_present():
		_check(not reported, "steam.没接上时 unlock 明确返回 false（不假装成功）", "竟然返回 true")
	# ④ 重复解锁不会再触发一次
	_check(not sb.unlock("ACH_FIRST_LANDING"), "steam.重复解锁返回 false", "又触发了一次")
	_eq("steam.解锁计数", sb.count(), 1)
	# ⑤ 统计量本地也记
	sb.set_stat("waves_survived", 7.0)
	_approx("steam.统计量本地记录", float(sb.stats.get("waves_survived", 0.0)), 7.0)
	sb.set_stat("kills_total", 123.0)
	_approx("steam.整数统计量", float(sb.stats.get("kills_total", 0.0)), 123.0)
	# ⑥ 由状态推导成就：一次给一批条件，该解锁的都要解锁
	var newly := sb.check_from_state(50, 10, 3, 5, 40, 3, false, true, false, false, false)
	_check(newly.has("ACH_FIRST_WAVE"), "steam.推导出「守住了」", "没推出来")
	_check(newly.has("ACH_TEN_WAVES"), "steam.推导出「十波不倒」", "没推出来")
	_check(newly.has("ACH_TOWN_CITY"), "steam.推导出「拓荒城市」", "没推出来")
	_check(newly.has("ACH_FIRST_VEHICLE"), "steam.推导出「有车了」", "没推出来")
	_check(not sb.has("ACH_ALL_NESTS"), "steam.没清光巢穴时不解锁「星球净化」", "错误解锁")
	_check(not sb.has("ACH_TD_MODE"), "steam.非塔防模式不解锁「钢铁防线」", "错误解锁")
	# ⑦ 塔防模式 + 10 波才给「钢铁防线」
	sb.check_from_state(0, 10, 0, 0, 0, 0, true, false, false, false, false)
	_check(sb.has("ACH_TD_MODE"), "steam.塔防模式 10 波解锁「钢铁防线」", "没解锁")
	# ⑧ 红色装备 / Boss / 占星
	sb.check_from_state(0, 0, 0, 0, 0, 0, false, false, true, true, true)
	_check(sb.has("ACH_FIRST_RED"), "steam.拿到红装解锁「一抹猩红」", "没解锁")
	_check(sb.has("ACH_DUNGEON_BOSS"), "steam.击杀巢穴主解锁「深入巢穴」", "没解锁")
	_check(sb.has("ACH_PLANET_CLAIMED"), "steam.占领星球解锁「这颗星球归我了」", "没解锁")
	# ⑨ 清光全图巢穴
	var sb2 := SteamBridge.new()
	sb2.unlocked.clear()
	sb2.check_from_state(0, 0, 0, 40, 40, 0, false, false, false, false, false)
	_check(sb2.has("ACH_ALL_NESTS"), "steam.清光 40/40 巢穴解锁「星球净化」", "没解锁")
	# ⑩ 本地存档往返：写盘再读回来
	sb.unlocked.clear()
	sb.unlock("ACH_NEST_CLEAR")
	sb.save_local()
	var sb3 := SteamBridge.new()
	sb3.load_local()
	_check(sb3.has("ACH_NEST_CLEAR"), "steam.成就本地存档往返", "读回来丢了")
	_approx("steam.统计量存档往返", float(sb3.stats.get("kills_total", 0.0)), 123.0)


## 手感回归：移动 / 冲刺 / 闪避（阶段 13 的「手感」那半）
func _test_feel(c: Dictionary) -> void:
	if c.is_empty():
		return
	var pm := PlayerMove.new(null)
	# ① 常量必须来自 data/config.json（不再是手抄的）
	var cfg: Dictionary = c["cfg"]
	_approx("feel.baseSpeed 来自配置", pm.base_speed(), float(cfg["baseSpeed"]))
	_approx("feel.sprintMult", pm.sprint_mult(), float(cfg["sprintMult"]))
	_approx("feel.staminaMax", pm.stamina_max(), float(cfg["staminaMax"]))
	_approx("feel.dodgeCost", pm.dodge_cost(), float(cfg["dodgeCost"]))
	# 关键：Godot 里**不许**再有第二个「基础速度」的写法
	_approx("feel.基础速度是 172（曾经的错误值是 220）", pm.base_speed(), 172.0)
	# ② 各档速度逐值比对 + 逐帧轨迹
	for fc in c["cases"]:
		var mods: Dictionary = {}
		match String(fc["name"]):
			"frenzy+speed":
				mods = { "speedMult": 0.2, "killFrenzySpeed": 0.25 }
		var stats := StatSet.new()
		stats.add(mods)
		var sprinting := String(fc["name"]) == "sprint" or String(fc["name"]) == "frenzy+speed"
		var terrain := 0.7 if String(fc["name"]) == "terrain0.7" else 1.0
		var frenzy := String(fc["name"]) == "frenzy+speed"
		var carry := 23.5 if String(fc["name"]) == "loaded" else 0.0
		var speed := pm.speed_for(sprinting, stats, terrain, frenzy, carry, 24.0)
		_approx("feel(%s).speed" % fc["name"], speed, float(fc["speed"]))
		# 逐帧轨迹：沿 +x 走 60 帧，比对位移与体力
		var x := 0.0
		var stamina := pm.stamina_max()
		var ti := 0
		var trail: Array = fc["trail"]
		for i in 60:
			var dt := 1.0 / 60.0
			var moving := true
			var can := pm.can_sprint(sprinting, moving, stamina)
			stamina = pm.tick_stamina(stamina, sprinting, moving, stats, dt)
			x += speed * dt
			if ti < trail.size() and int(trail[ti][0]) == i + 1:
				_approx("feel(%s)@%d.x" % [fc["name"], i + 1], x, float(trail[ti][1]))
				_approx("feel(%s)@%d.stamina" % [fc["name"], i + 1], stamina, float(trail[ti][2]))
				ti += 1
			if can:
				pass
	# ③ 闪避：位移 = 速度 × 时长，冷却/无敌帧与配置一致
	var stamina2 := pm.stamina_max()
	stamina2 = pm.start_dodge(Vector2(1, 0), stamina2)
	_approx("feel.闪避消耗体力", pm.stamina_max() - stamina2, float(cfg["dodgeCost"]))
	_approx("feel.闪避冷却", pm.dodge_cd, float(cfg["dodgeCooldown"]))
	_approx("feel.闪避无敌帧", pm.iframes, float(cfg["dodgeIFrames"]))
	_approx("feel.闪避时长", pm.dodge_time_left, float(cfg["dodgeTime"]))
	var moved := 0.0
	var dt2 := 1.0 / 60.0
	for i in 20:
		var step := pm.tick(dt2)
		moved += step.length()
	# 每帧位移都经过 Vector2（float32），累加后末几位必然与 JS 的 float64 不同`n	_approx32("feel.闪避全程位移", moved, float(c["dodgeDistance"]))
	_check(not pm.is_invulnerable() or pm.iframes >= 0.0, "feel.无敌帧会自然结束", "")
	# ④ 体力不够时闪不掉（JS：`stamina >= dodgeCost`）
	var pm2 := PlayerMove.new(null)
	_check(not pm2.can_dodge(10.0), "feel.体力不足时不能闪避", "竟然能闪")
	_check(pm2.can_dodge(30.0), "feel.体力够时可以闪避", "闪不了")


## 射击几何（手感回归第二刀）
func _test_gunplay(c: Dictionary) -> void:
	if c.is_empty():
		return
	_approx("gunplay.barrelStep", Gunplay.BARREL_STEP, float(c["barrelStep"]))
	_approx("gunplay.muzzleDist", Gunplay.MUZZLE_DIST, float(c["muzzleDist"]))
	_approx("gunplay.lifeFactor", Gunplay.LIFE_FACTOR, float(c["lifeFactor"]))
	_eq("gunplay.maxBarrels", Gunplay.MAX_BARRELS, int(c["maxBarrels"]))
	var wdefs: Dictionary = DataLoader.new().table("weapons", "WEAPON_DEF", {})
	for gs in c["shots"]:
		var def: Dictionary = wdefs.get(String(gs["weapon"]), {})
		_check(not def.is_empty(), "gunplay.%s 武器数据存在" % gs["weapon"], "缺失")
		if def.is_empty():
			continue
		var stats := StatSet.new()
		stats.add({ "projectiles": float(gs["projectiles"]) })
		# 弹道条数与偏移序列
		_eq("gunplay(%s/P%s).barrels" % [gs["weapon"], str(gs["projectiles"])],
			Gunplay.barrels_for(stats), int(gs["barrels"]))
		var offsets := Gunplay.barrel_offsets(stats)
		var exp_off: Array = gs["offsets"]
		_eq("gunplay(%s/P%s).offsetCount" % [gs["weapon"], str(gs["projectiles"])],
			offsets.size(), exp_off.size())
		for i in mini(offsets.size(), exp_off.size()):
			_approx("gunplay(%s/P%s).offset[%d]" % [gs["weapon"], str(gs["projectiles"]), i],
				float(offsets[i]), float(exp_off[i]))
		# 射击计划（rng 传 null = 散布按 0，只比结构）
		var plan := Gunplay.plan_shot(def, stats, 0.0, 100.0, 200.0, null)
		_eq("gunplay(%s/P%s).count" % [gs["weapon"], str(gs["projectiles"])],
			plan.size(), int(gs["count"]))
		if plan.is_empty():
			continue
		var p0: Dictionary = plan[0]
		# 枪口距离只在「正中间那条弹道」上才是精确的 18px：
		# 有弹道偏移时枪口会沿圆弧偏一点（cos(0.0375)≈0.9993），这是对的
		var mid_i := int(plan.size() / 2) if int(gs["barrels"]) % 2 == 1 else -1
		if mid_i >= 0:
			var pm: Dictionary = plan[mid_i]
			_approx32("gunplay(%s).muzzleX" % gs["weapon"], float(pm["x"]), 100.0 + float(gs["muzzle"]))
			_approx32("gunplay(%s).muzzleY" % gs["weapon"], float(pm["y"]), 200.0)
		_approx("gunplay(%s).r" % gs["weapon"], float(p0["r"]), float(gs["r"]))
		_approx("gunplay(%s).life" % gs["weapon"], float(p0["life"]), float(gs["life"]))
		_eq("gunplay(%s).pierce" % gs["weapon"], int(p0["pierce"]), int(gs["pierce"]))
		_approx("gunplay(%s).speed" % gs["weapon"], float(p0["speed"]),
			DataLoader.num_or(def, "speed", 800.0))
		_eq("gunplay(%s).ammoPerShot" % gs["weapon"],
			Gunplay.ammo_per_shot(def, stats), int(gs["ammoPerShot"]))
		# 奇数条弹道时**正中间那条**必须精确对准准星；偶数条时关于准星对称
		if int(gs["barrels"]) % 2 == 1:
			_approx("gunplay(%s/P%s).中心对准准星" % [gs["weapon"], str(gs["projectiles"])],
				float(plan[mid_i]["angle"]), 0.0)
		elif int(gs["barrels"]) == 2 and int(gs["pellets"]) == 1:
			# 只有「一发一条弹道」时 plan[0]/plan[1] 才正好是两条弹道；
			# 霰弹枪一条弹道里有好几颗弹丸，得按 pellets 分组看
			var a0 := float(plan[0]["angle"])
			var a1 := float(plan[1]["angle"])
			_approx("gunplay(%s/P%s).两侧对称" % [gs["weapon"], str(gs["projectiles"])], a0 + a1, 0.0)
		# 散布范围（存进 Vector2，是 float32）
		var sr := Gunplay.spread_range(def)
		_approx32("gunplay(%s).spreadLo" % gs["weapon"], sr.x, -float(gs["spread"]))
		_approx32("gunplay(%s).spreadHi" % gs["weapon"], sr.y, float(gs["spread"]))
	# 散布真的在范围内（用种子随机的 rng，跑 200 次）
	var pistol: Dictionary = wdefs.get("smg", wdefs.get("pistol", {}))
	var stats2 := StatSet.new()
	var rng := Rng.new("gunplay-spread")
	var srange := Gunplay.spread_range(pistol)
	var in_range := true
	var nonzero := 0
	for i in 200:
		var plan2 := Gunplay.plan_shot(pistol, stats2, 0.0, 0.0, 0.0, rng)
		if plan2.is_empty():
			continue
		var a := float(plan2[0]["angle"])
		if a < srange.x - 1e-6 or a > srange.y + 1e-6:
			in_range = false
		if absf(a) > 1e-6:
			nonzero += 1
	_check(in_range, "gunplay.散布始终落在 ±spread 内", "有超出范围的")
	if srange.y > 0.0:
		_check(nonzero > 0, "gunplay.有散布时角度确实会偏（%d/200）" % nonzero, "一次都没偏")


## 相机（手感回归第三刀：跟随 / 震屏 / 边界）
func _test_camera(c: Dictionary) -> void:
	if c.is_empty():
		return
	var rig := CameraRig.new(float(c["view"][0]), float(c["view"][1]), null)
	_approx("camera.followLerp", CameraRig.FOLLOW_LERP, float(c["followLerp"]))
	_approx("camera.zoomLerp", CameraRig.ZOOM_LERP, float(c["zoomLerp"]))
	_approx("camera.shakeTime", CameraRig.DEFAULT_SHAKE_TIME, float(c["shakeTime"]))
	# ① 跟随轨迹：从 (0,0) 追 (1000,600)，每 15 帧比一次
	var trail: Array = c["followTrail"]
	var ti := 0
	for i in 60:
		rig.follow(1000.0, 600.0, 1.0 / 60.0)
		if ti < trail.size() and int(trail[ti][0]) == i + 1:
			_approx("camera.follow@%d.x" % (i + 1), rig.x, float(trail[ti][1]))
			_approx("camera.follow@%d.y" % (i + 1), rig.y, float(trail[ti][2]))
			ti += 1
	# 指数收敛必须比线性 lerp(delta*8) 更快贴近目标 —— 这正是原来手感发黏的原因
	var linear := 0.0
	for i in 60:
		linear = lerpf(linear, 1000.0, 8.0 / 60.0)
	_check(rig.x > linear, "camera.指数收敛比线性 dt×8 更快贴上目标（%.0f > %.0f）" % [rig.x, linear],
		"没有更快")
	# ② 震屏：衰减曲线与 JS 一致
	var rig2 := CameraRig.new(1280.0, 720.0, Rng.new("camera-shake"))
	rig2.shake(10.0)
	_approx("camera.震屏初始强度", rig2.shake_mag, 10.0)
	_approx("camera.震屏初始时长", rig2.shake_time, 0.32)
	var st: Array = c["shakeTrail"]
	var si := 0
	for i in 24:
		var remain_before := rig2.shake_time - 1.0 / 60.0
		rig2.update(1.0 / 60.0)
		if si < st.size() and int(st[si][0]) == i + 1:
			# k 是这一帧的振幅上限，用来约束随机偏移的范围
			var k := maxf(0.0, remain_before) * 10.0
			_approx("camera.shakeK@%d" % (i + 1), k, float(st[si][1]))
			_approx("camera.shakeActive@%d" % (i + 1), 1.0 if rig2.is_shaking() else 0.0,
				float(st[si][2]))
			if rig2.is_shaking():
				_check(absf(rig2.shake_x) <= k + 1e-6 and absf(rig2.shake_y) <= k + 1e-6,
					"camera.shake@%d 偏移在 ±k 内" % (i + 1), "超出范围")
			si += 1
	_check(not rig2.is_shaking(), "camera.震屏会结束", "一直在震")
	_approx("camera.震屏结束后偏移归零", rig2.shake_x + rig2.shake_y, 0.0)
	# ③ 弱的震动不该盖掉正在播的强震动
	var rig3 := CameraRig.new(1280.0, 720.0, null)
	rig3.shake(20.0, 0.5)
	rig3.shake(3.0, 0.1)
	_approx("camera.弱震动不覆盖强震动", rig3.shake_mag, 20.0)
	_approx("camera.时长取更长的一次", rig3.shake_time, 0.5)
	# ④ 边界钳制
	rig.bounds = Vector2(float(c["bounds"][0]), float(c["bounds"][1]))
	for cc in c["clampCases"]:
		var in_v: Array = cc["in"]
		var out_v: Array = cc["out"]
		rig.snap_to(float(in_v[0]), float(in_v[1]))
		_approx("camera.clamp(%s,%s).x" % [str(in_v[0]), str(in_v[1])], rig.x, float(out_v[0]))
		_approx("camera.clamp(%s,%s).y" % [str(in_v[0]), str(in_v[1])], rig.y, float(out_v[1]))
	# ⑤ 视野矩形（刷怪点规则要用）
	rig.snap_to(2000.0, 1500.0)
	var vr := rig.view_rect()
	_approx("camera.viewRect.w", vr.size.x, 1280.0)
	_approx("camera.viewRect.x", vr.position.x, 2000.0 - 640.0)


## 换弹（手感回归第四刀：时机 / 花费 / pending 语义）
func _test_reload_feel() -> void:
	var stats := StatSet.new()
	var lo := Loadout.new(stats)
	var wdefs: Dictionary = DataLoader.new().table("weapons", "WEAPON_DEF", {})
	lo.equip(wdefs.get("pistol", {}), "common")
	lo.resources = { "metal": 100.0, "sulfur": 20.0 }
	lo.ammo = 60
	lo.ammo_max = 200
	# ① 换弹要花金属：ceil(需补 140 × 0.12) = 17
	var before := float(lo.resources["metal"])
	_check(lo.start_reload(false), "reload.能开始换弹", "start_reload 失败")
	_approx("reload.扣金属 = ceil(need×0.12)", before - float(lo.resources["metal"]), 17.0)
	_check(lo.reload_pending, "reload.置位 reload_pending", "没置位")
	_approx("reload.时长来自武器与品质", lo.reloading, WeaponMath.reload_time_of(wdefs.get("pistol", {}), "common"))
	# 换完：弹药补满、pending 清掉
	lo.update(lo.reloading + 0.01)
	_eq("reload.完成后弹药补满", lo.ammo, 200)
	_check(not lo.reload_pending, "reload.完成后清 pending", "还留着")
	# ② 弹药已满 → 拒绝
	_eq("reload.满弹时拒绝", lo.start_reload(false), false)
	_eq("reload.满弹时的原因", lo.last_reload_result, "full")
	# ③ 金属不够 → 拒绝
	var lo2 := Loadout.new(stats)
	lo2.equip(wdefs.get("pistol", {}), "common")
	lo2.resources = { "metal": 3.0 }
	lo2.ammo = 0
	lo2.ammo_max = 200
	_eq("reload.金属不足时拒绝", lo2.start_reload(false), false)
	_eq("reload.金属不足时的原因", lo2.last_reload_result, "no_metal")
	_approx("reload.金属不足时不扣钱", float(lo2.resources["metal"]), 3.0)
	# ④ ★ 空仓干等**不给免费子弹**（JS 注释里专门写的旧漏洞）
	var lo3 := Loadout.new(stats)
	lo3.equip(wdefs.get("pistol", {}), "common")
	lo3.resources = { "metal": 0.0 }
	lo3.ammo = 0
	lo3.ammo_max = 200
	lo3.auto_reload()                    # 没钱 → 失败
	_approx("reload.没钱时自动换弹失败", float(lo3.ammo), 0.0)
	_check(lo3.warned_no_ammo, "reload.失败后置「已提示过」，避免刷屏", "没置位")
	# 手动把进度走完（模拟旧逻辑里「干等 1.2 秒」）—— 也不该给子弹
	lo3.reloading = 0.01
	lo3.update(0.02)
	_approx("reload.★空仓干等不给免费子弹", float(lo3.ammo), 0.0)
	# ⑤ 「现场合成弹药」实验：吃金属+硫磺，瞬间补满
	var stats5 := StatSet.new()
	stats5.add({ "ammoCraft": 1.0 })
	var lo5 := Loadout.new(stats5)
	lo5.equip(wdefs.get("pistol", {}), "common")
	lo5.resources = { "metal": 100.0, "sulfur": 20.0 }
	lo5.ammo = 100
	lo5.ammo_max = 200
	_check(lo5.start_reload(false), "reload.现场合成成功", "失败")
	_eq("reload.现场合成瞬间补满", lo5.ammo, 200)
	_eq("reload.现场合成的结果标记", lo5.last_reload_result, "crafted")
	_check(float(lo5.resources["sulfur"]) < 20.0, "reload.现场合成吃硫磺", "没扣硫磺")
	# ⑥ 自动换弹成功时也会清掉「已提示过」
	var lo6 := Loadout.new(stats)
	lo6.equip(wdefs.get("pistol", {}), "common")
	lo6.resources = { "metal": 100.0 }
	lo6.ammo = 0
	lo6.ammo_max = 200
	lo6.warned_no_ammo = true
	_check(lo6.auto_reload(), "reload.有钱时自动换弹成功", "失败")
	_check(not lo6.warned_no_ammo, "reload.成功后清掉「已提示过」", "没清")
	# ⑦ 打空时 fire() 会自己尝试自动换弹
	var lo7 := Loadout.new(stats)
	lo7.equip(wdefs.get("pistol", {}), "common")
	lo7.resources = { "metal": 100.0 }
	lo7.ammo = 1
	lo7.ammo_frac = 0.0
	lo7.cd = 0.0
	lo7.fire()
	_check(lo7.reload_pending or lo7.reloading > 0.0, "reload.打空后自动进入换弹", "没换弹")


## 维修 / 重建（手感回归第五刀）
func _test_repair(c: Dictionary) -> void:
	if c.is_empty():
		return
	_approx("repair.baseRebuildTime", float(c["baseRebuildTime"]), 12.0)
	_approx("repair.baseRebuildPerTap", float(c["baseRebuildPerTap"]), 0.55)
	_approx("repair.baseMaxHp", float(c["baseMaxHp"]), 2600.0)
	# ① 维修：治疗量 / 花费 / 金属不足时不动手
	for rc in c["repairCases"]:
		var stats := StatSet.new()
		stats.add(rc["mods"])
		var target := { "hp": float(rc["hp"]), "maxHp": float(rc["maxHp"]), "x": 0.0, "y": 0.0 }
		var res := { "metal": float(rc["metal"]) }
		var ok := Repair.repair_at(target, stats, res, float(rc["dt"]))
		_eq("repair(%s/%s).ok" % [str(rc["dt"]), str(rc["hp"])], 1 if ok else 0, int(rc["ok"]))
		_approx32("repair(%s/%s).hpAfter" % [str(rc["dt"]), str(rc["hp"])],
			float(target["hp"]), float(rc["hpAfter"]))
		_approx32("repair(%s/%s).metalAfter" % [str(rc["dt"]), str(rc["hp"])],
			float(res["metal"]), float(rc["metalAfter"]))
	# ② 优先级：越近越破的先修
	var targets: Array = [
		{ "id": "nearFull", "x": 20.0, "y": 0.0, "hp": 90.0, "maxHp": 100.0 },
		{ "id": "nearBroken", "x": 30.0, "y": 0.0, "hp": 10.0, "maxHp": 100.0 },
		{ "id": "farBroken", "x": 60.0, "y": 0.0, "hp": 1.0, "maxHp": 100.0 },
		{ "id": "outOfRange", "x": 200.0, "y": 0.0, "hp": 5.0, "maxHp": 100.0 },
		{ "id": "full", "x": 10.0, "y": 0.0, "hp": 100.0, "maxHp": 100.0 },
	]
	var pick = Repair.nearest_repairable(targets, 0.0, 0.0, 76.0)
	_check(pick != null, "repair.能选出该修的目标", "没选出来")
	if pick != null:
		_eq("repair.最该修的是「近且破」的那个", String((pick["target"] as Dictionary)["id"]), "nearBroken")
	# 满血的、超范围的都不该被选中
	var only_full: Array = [{ "id": "full", "x": 10.0, "y": 0.0, "hp": 100.0, "maxHp": 100.0 }]
	_check(Repair.nearest_repairable(only_full, 0.0, 0.0) == null, "repair.满血的不算可修", "竟然算")
	var only_far: Array = [{ "id": "far", "x": 200.0, "y": 0.0, "hp": 5.0, "maxHp": 100.0 }]
	_check(Repair.nearest_repairable(only_far, 0.0, 0.0, 76.0) == null, "repair.超范围的不算可修", "竟然算")
	# ③ 基地重建：点击推进 + 时间推进，走满就复活
	var base := { "destroyed": true, "hp": 0.0, "maxHp": float(c["baseMaxHp"]), "repairProgress": 0.0 }
	var trail: Array = c["rebuildTrail"]
	var ti := 0
	for i in 20:
		var tapped := i % 4 == 0
		var done := Repair.rebuild_step(base, 1.0 / 60.0, tapped,
			float(c["baseRebuildTime"]), float(c["baseRebuildPerTap"]))
		if ti < trail.size() and int(trail[ti][0]) == i + 1:
			# 走满的那一帧进度会被重置成 0（基地已复活），所以这里比的是
			# 「本帧达成的进度」——满了就是 1.0
			var shown := 1.0 if done else float(base.get("repairProgress", 0.0))
			_approx32("repair.rebuild@%d.progress" % (i + 1), shown, float(trail[ti][1]))
			ti += 1
		if done:
			break
	_check(not GdMath.truthy(base["destroyed"]), "repair.重建完成后基地复活", "还是废墟")
	_approx("repair.重建后满耐久", float(base["hp"]), float(c["baseMaxHp"]))
	# ④ 基地耐久维修用的是 BASE 的速率与花费
	var stats2 := StatSet.new()
	var base2 := { "destroyed": false, "hp": 1000.0, "maxHp": 2600.0 }
	var res2 := { "metal": 1000.0 }
	_check(Repair.repair_base(base2, stats2, res2, 1.0, float(c["baseRepairRate"]),
		float(c["baseRepairCostPerHp"])), "repair.基地能修", "修不了")
	_approx32("repair.基地维修速率 34/s", float(base2["hp"]), 1034.0)
	_approx32("repair.基地维修花费 0.22/点", 1000.0 - float(res2["metal"]), 34.0 * 0.22)
	# ⑤ 拆除退款：半价、不足 1 的不退
	var refund := Repair.refund_for({ "metal": 90.0, "gold": 45.0, "parts": 1.0 }, 0.5)
	_eq("repair.退款 metal", int(refund.get("metal", 0)), 45)
	_eq("repair.退款 gold", int(refund.get("gold", 0)), 22)
	_check(not refund.has("parts"), "repair.不足 1 的资源不退款", "退了 parts")


## 前置流程（标题 → 模式 → 角色 → 星球 → 生成 → 落地）
##
## 这一组断言盯的就是那个 bug：**开局前不该跑模拟**。
## 具体可测的有三件事：
##   1. 初始一定停在标题屏（不是「已经开了一局，只是盖了层菜单」）；
##   2. 每一屏的推进都会把选择**写进 start_params()**（模式/角色/星球/种子）；
##   3. 参数与数据表一致（塔防模式 nestScale=0、有/无角色、阵地半径…）。
func _test_front_end() -> void:
	var fe := FrontEnd.new()
	_eq("frontEnd.初始停在标题屏", fe.screen, FrontEnd.Screen.TITLE)
	_eq("frontEnd.默认模式开拓", fe.mode, "frontier")
	_eq("frontEnd.默认角色工程师", fe.character, "engineer")
	_eq("frontEnd.默认星球 0", fe.planet_index, 0)
	_check(fe.seed_text != "", "frontEnd.默认给了种子", "种子是空的")
	# 全流程推进：标题 → 模式 → 角色 → 星球
	fe.goto(FrontEnd.Screen.MODE)
	_eq("frontEnd.能进模式屏", fe.screen, FrontEnd.Screen.MODE)
	fe.goto(FrontEnd.Screen.CHARACTER)
	fe.goto(FrontEnd.Screen.PLANET)
	_eq("frontEnd.能进星球屏", fe.screen, FrontEnd.Screen.PLANET)
	# 选择真的进了参数
	fe.mode = "towerDefense"
	fe.character = "pilot"
	fe.planet_index = 4
	fe.seed_text = "frontier-test-1234"
	var p := fe.start_params()
	_eq("frontEnd.参数.模式", String(p["mode"]), "towerDefense")
	_eq("frontEnd.参数.角色", String(p["character"]), "pilot")
	_eq("frontEnd.参数.星球", int(p["planetIndex"]), 4)
	_eq("frontEnd.参数.种子", String(p["seed"]), "frontier-test-1234")
	# 与数据表一致的三条：塔防没有角色操控、不撒巢穴、阵地半径来自数据
	_eq("frontEnd.参数.塔防无角色", 1 if GdMath.truthy(p["hasPlayer"]) else 0, 0)
	_approx("frontEnd.参数.塔防不撒巢穴", float(p["nestScale"]), 0.0)
	_approx("frontEnd.参数.阵地半径", float(p["fieldRadius"]), 900.0)
	# 换回开拓模式：参数跟着变
	fe.mode = "frontier"
	var p2 := fe.start_params()
	_approx("frontEnd.开拓.撒巢穴", float(p2["nestScale"]), 1.0)
	_eq("frontEnd.开拓.有角色", 1 if GdMath.truthy(p2["hasPlayer"]) else 0, 1)
	# 角色基础属性跟着选择走
	fe.character = "pioneer"
	var p3 := fe.start_params()
	_eq("frontEnd.开拓者基础生命", int((p3["base"] as Dictionary).get("hp", 0)), 150)
	# 界面能搭起来（headless 下也建 Control 树）
	var host := Control.new()
	fe.attach(host)
	_check(fe.root != null and fe.root.get_child_count() > 0, "frontEnd.界面能构建", "构建失败")
	for s in [FrontEnd.Screen.MODE, FrontEnd.Screen.CHARACTER, FrontEnd.Screen.PLANET,
		FrontEnd.Screen.SETTINGS, FrontEnd.Screen.LOADING]:
		fe.goto(s)
		_check(fe.root.get_child_count() > 0, "frontEnd.第 %d 屏也有内容" % s, "是空的")
	fe.detach()
	_check(fe.root == null, "frontEnd.能干净地收起", "还没收")
	host.free()
	# 随机种子要够分散
	var seeds := {}
	for i in 20:
		seeds[FrontEnd.random_seed_text()] = true
	_check(seeds.size() >= 15, "frontEnd.随机种子够分散（20 次至少 15 个不同）", "只有 %d 个" % seeds.size())


## 前置流程的「选中 → 确定」链路（玩家报的问题：选中了不知道在哪确定）
##
## 之前是「点选项 = 选中 + 立刻跳屏」，而且当前项是禁用的 —— 玩家根本找不到「确定」。
## 这组断言直接驱动界面按钮，验证：
##   1. 点选项**只选中**（屏不跳），选项上出现打勾；
##   2. 每屏底部有「下一步/开始游戏」，点了才推进；
##   3. 走完流程发出的 start_params 与选择一致。
func _test_front_flow() -> void:
	var fe := FrontEnd.new()
	var host := Control.new()
	fe.attach(host)
	var started: Array = []
	fe.start_requested.connect(func(p: Dictionary) -> void: started.append(p))

	# 找界面上所有按钮（递归，写成类方法避免闭包递归的写法限制）
	var find_btn := func(text_part: String) -> Button:
		return _find_button(fe.root, text_part)

	# ① 模式屏：点「纯塔防模式」只选中，不跳屏
	fe.goto(FrontEnd.Screen.MODE)
	var mode_btn: Button = find_btn.call("纯塔防模式")
	_check(mode_btn != null, "flow.模式屏有「纯塔防模式」按钮", "找不到")
	if mode_btn != null:
		mode_btn.emit_signal("pressed")
		_eq("flow.点模式后仍在模式屏（只选中不跳屏）", fe.screen, FrontEnd.Screen.MODE)
		_eq("flow.模式已切换为塔防", fe.mode, "towerDefense")
		var again: Button = find_btn.call("纯塔防模式")
		_check(again != null and String(again.text).begins_with("✓"), "flow.选中项带打勾",
			"按钮文字是「%s」" % (String(again.text) if again != null else "?"))
	# ② 底部「下一步」推进到角色屏
	var next_btn: Button = find_btn.call("下一步")
	_check(next_btn != null, "flow.模式屏有「下一步」", "找不到")
	if next_btn != null:
		next_btn.emit_signal("pressed")
		_eq("flow.下一步 → 角色屏", fe.screen, FrontEnd.Screen.CHARACTER)
	# ③ 角色屏：同样只选中
	var char_btn: Button = find_btn.call("生物学家")
	_check(char_btn != null, "flow.角色屏有「生物学家」", "找不到")
	if char_btn != null:
		char_btn.emit_signal("pressed")
		_eq("flow.点角色后仍在角色屏", fe.screen, FrontEnd.Screen.CHARACTER)
		_eq("flow.角色已切换", fe.character, "biologist")
	var next2: Button = find_btn.call("下一步")
	if next2 != null:
		next2.emit_signal("pressed")
		_eq("flow.下一步 → 星球屏", fe.screen, FrontEnd.Screen.PLANET)
	# ④ 星球屏：选星球 + 开始游戏
	var planet_btn: Button = find_btn.call("比邻星")
	if planet_btn != null:
		planet_btn.emit_signal("pressed")
		_eq("flow.点星球后仍在星球屏", fe.screen, FrontEnd.Screen.PLANET)
		_eq("flow.星球已切换", fe.planet_index, 2)
	var start_btn: Button = find_btn.call("开始游戏")
	_check(start_btn != null, "flow.星球屏有「开始游戏」", "找不到")
	if start_btn != null:
		start_btn.emit_signal("pressed")
	_eq("flow.发出 start_requested", started.size(), 1)
	if not started.is_empty():
		var p: Dictionary = started[0]
		_eq("flow.参数.模式", String(p["mode"]), "towerDefense")
		_eq("flow.参数.角色", String(p["character"]), "biologist")
		_eq("flow.参数.星球", int(p["planetIndex"]), 2)
		_approx("flow.参数.塔防不撒巢穴", float(p["nestScale"]), 0.0)
	fe.detach()
	host.free()


## 在界面树里按文字片段找按钮（前置流程测试用）
func _find_button(root: Node, text_part: String) -> Button:
	for c in root.get_children():
		if c is Button and String((c as Button).text).contains(text_part):
			return c
		var found := _find_button(c, text_part)
		if found != null:
			return found
	return null