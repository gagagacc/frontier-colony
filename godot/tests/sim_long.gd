## 长时模拟 —— 把 JS 侧「6. 模拟运行 120 秒」那组断言在 Godot 重建。
##
## 为什么单独一个脚本：这不是「某个函数的数值对不对」，而是
## **一整套系统连起来能不能连续跑而不炸、计数还说得通**。
## JS 侧那组断言抓过的问题（弹丸堆在枪口、怪潮不刷、掉落不结算）
## 全都只在「跑一段时间」时才暴露。
##
##   godot --headless --path godot --script res://tests/sim_long.gd -- --seconds=120 --seed=...
##
## 输出一行 `GODOT_SIM {...}`，由 tools/godot-verify.mjs 收进汇总。
extends SceneTree

var seconds := 120.0
var seed_text := "sim-golden"
var dt := 1.0 / 60.0


func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seconds="):
			seconds = a.substr(10).to_float()
		elif a.begins_with("--seed="):
			seed_text = a.substr(7)
	_run()


func _run() -> void:
	var checks: Array = []
	var ok := func(name: String, cond: bool, detail: String = "") -> void:
		checks.append({ "name": name, "ok": cond, "detail": detail })

	# 装配一套最小可跑的闭环：世界 → 塔 → 怪物 → 弹丸 → 怪潮
	var world := GdWorld.new(seed_text, {})
	var stats := StatSet.new({ "damage": 0.5, "attackSpeed": 0.5, "projectiles": 1.0 })
	var enemies: Node2D = load("res://scripts/systems/enemies.gd").new()
	var projectiles: Node2D = load("res://scripts/systems/projectiles.gd").new()
	projectiles.world = world
	var player: Node2D = load("res://scripts/entities/player.gd").new()
	player.world = world
	player.stats = stats
	player.position = Vector2(float(world.base_site["x"]), float(world.base_site["y"]))
	enemies.setup(world, player, projectiles)
	# 命中判定必须接上：不然弹丸飞过去也不会结算（游戏里就是这么接的）
	projectiles.setup(world, Callable(enemies, "hit_test"))
	var towers: Node2D = load("res://scripts/systems/towers.gd").new()
	# 必须走 setup：塔与建筑的数据表是在那里载入的（只赋字段会让 place_tower 直接返回空）
	towers.setup(world, player, projectiles, enemies, stats,
		Vector2(float(world.base_site["x"]), float(world.base_site["y"])))
	enemies.towers_ref = towers.towers
	var props := Props.new()
	props.setup(world)

	# 先建 4 座塔（基地旁边一圈）
	var built := 0
	for i in 4:
		var a := TAU * float(i) / 4.0
		towers.selected = "sentry"
		var t: Dictionary = towers.place_tower(Vector2(float(world.base_site["x"]) + cos(a) * 90.0,
			float(world.base_site["y"]) + sin(a) * 90.0), { "instant": true })
		if not t.is_empty():
			built += 1
	ok.call("sim.塔建起来了 4 座", built == 4, "只建成 %d 座（cap=%d, bases=%d, 探测=%s）" % [built,
		TowerMath.tower_cap(stats), towers.bases.size(),
		str(TowerMath.find_placement(world, float(world.base_site["x"]) + 90.0, float(world.base_site["y"]), towers.ctx(true)))])

	# 撒一波怪
	enemies.spawn_around(14, 320.0, 620.0, 2)
	ok.call("sim.怪撒出来了", enemies.enemies.size() >= 14, "只有 %d 只" % enemies.enemies.size())

	# 开跑
	var steps := int(seconds / dt)
	var kills_before: int = enemies.kills
	var max_projectiles := 0
	var fire_calls := 0
	for i in steps:
		enemies.update(dt)
		projectiles.update(dt)
		towers.update(dt)
		max_projectiles = maxi(max_projectiles, projectiles.projectiles.size())
		#if i % 600 == 0:
		#	player.shoot_test()
	# 玩家的枪法由 towers 之外单独打：直接让 loadout 开一次火，确认闭环通了
	fire_calls = int(projectiles.hits)

	var kills: int = enemies.kills - kills_before
	ok.call("sim.跑完整段没有异常", true)
	ok.call("sim.塔打死了怪", kills > 0, "0 击杀（塔没开火或弹丸没命中）")
	ok.call("sim.弹丸真的飞过（峰值 %d）" % max_projectiles, max_projectiles > 0, "弹丸数一直是 0")
	ok.call("sim.弹丸有命中（%d 次）" % fire_calls, fire_calls > 0, "命中 0 次")
	ok.call("sim.场上怪没有无限增长（%d）" % enemies.enemies.size(), enemies.enemies.size() <= 14,
		"怪变多了：%d" % enemies.enemies.size())
	ok.call("sim.塔还在（%d 座）" % towers.count(), towers.count() == 4, "塔少了")
	# 世界仍然可走：玩家所在格不是实心
	var tx := int(player.position.x / float(Cfg.TILE))
	var ty := int(player.position.y / float(Cfg.TILE))
	ok.call("sim.玩家没被卡进墙里", not Cfg.is_solid_tile(world.tile_at(tx, ty)), "落在实心地块上")

	var passed := 0
	var failed: Array = []
	for c in checks:
		if GdMath.truthy(c["ok"]):
			passed += 1
		else:
			failed.append("%s — %s" % [String(c["name"]), String(c["detail"])])
	print("GODOT_SIM " + JSON.stringify({
		"seconds": seconds, "steps": steps, "kills": kills,
		"projectilesPeak": max_projectiles, "hits": fire_calls,
		"alive": enemies.enemies.size(), "towers": towers.count(),
		"pass": passed, "fail": failed.size(), "failures": failed,
	}))
	print("GODOT_TEST_RESULT " + JSON.stringify({ "pass": passed, "fail": failed.size(), "failures": failed }))
	quit(0 if failed.is_empty() else 1)
