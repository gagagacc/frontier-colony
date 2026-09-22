## 防御塔系统 —— `src/systems/towers.js` 的移植（阶段 7：建造 + 索敌 + 开火 + 维修）。
##
## 规则全部照搬 JS：
##   - 建造点由 `TowerMath.find_placement` 决定（空地要间隔 / 基座免间隔）；
##   - 塔的属性 = 数据表 × 属性引擎（塔伤害/射速/射程三条科技线）；
##   - 索敌优先级：离基地最近 > 血量最高 > 最近（JS acquireTarget）；
##   - 建造中不能开火，进度按 buildTime 走（空投舱下落）。
##
## 玩家操作（阶段 7 的临时接口，阶段 11 会换成正经建造面板）：
##   1 键：在鼠标处铺【防御塔基座】  2 键：在鼠标处空投一座哨戒塔
extends Node2D

const BUILD_INTERVAL_ROUNDS := 40.0

var world: GdWorld
var player: Node2D
var projectiles: Node2D
var enemies: Node2D
var stats: StatSet

var _time := 0.0          # 呼吸/闪烁动画用
var towers: Array = []
var structures: Array = []
var bases: Array = []
var selected := "sentry"           # 当前选的塔
var built := 0
var repaired := 0.0

var _tower_defs: Dictionary = {}
var _structure_defs: Dictionary = {}
var _preview: Variant = null
var _preview_valid := false


func setup(p_world: GdWorld, p_player: Node2D, p_projectiles: Node2D, p_enemies: Node2D, p_stats: StatSet, base_pos: Vector2) -> void:
	world = p_world
	player = p_player
	projectiles = p_projectiles
	enemies = p_enemies
	stats = p_stats
	_tower_defs = DataLoader.new().table("towers", "TOWER_DEF", {})
	_structure_defs = DataLoader.new().table("towers", "STRUCTURE_DEF", {})
	bases = [{
		"x": base_pos.x, "y": base_pos.y, "r": 96.0,
		"destroyed": false, "buildRadius": 520.0,
	}]


func ctx(for_tower: bool = true) -> Dictionary:
	return { "towers": towers, "structures": structures, "bases": bases, "for_tower": for_tower }


## 放置预览（鼠标位置）；返回 { ok, x, y, onPlatform }
func update_preview(mouse: Vector2, for_tower: bool = true) -> Dictionary:
	var spot = TowerMath.find_placement(world, mouse.x, mouse.y, ctx(for_tower))
	_preview = spot
	_preview_valid = spot != null
	queue_redraw()
	if spot == null:
		return { "ok": false }
	return { "ok": true, "x": float(spot["x"]), "y": float(spot["y"]),
		"onPlatform": GdMath.truthy(spot["onPlatform"]) }


## 铺一块防御塔基座
func place_structure(type: String, mouse: Vector2) -> bool:
	var def: Dictionary = _structure_defs.get(type, {})
	if def.is_empty():
		return false
	var spot = TowerMath.find_placement(world, mouse.x, mouse.y, ctx(false))
	if spot == null:
		return false
	structures.append({
		"type": type, "x": float(spot["x"]), "y": float(spot["y"]),
		"hp": DataLoader.num_or(def, "hp", 200.0), "maxHp": DataLoader.num_or(def, "hp", 200.0),
		"blocks": DataLoader.bool_of(def, "blocks", false),
		"r": 30.0 if DataLoader.int_of(def, "size", 1) > 1 else 18.0,
	})
	# 只有**会挡路**的建筑才占位（JS 的 `s.blocks` 只有墙是 true）。
	# 这里以前无条件置 1，结果基座把自己的格子标成不可通行 ——
	# find_placement 第一件事就是 `is_blocked_px` 跳过，于是「塔永远放不到基座上」，
	# 正是玩家抱怨过的那句「基座太鸡肋」。黄金对比看不到这类集成错误
	#（它只比 find_placement 的纯逻辑），所以测试里补了一条端到端断言。
	if DataLoader.bool_of(def, "blocks", false):
		world.set_blocked(int(floor(float(spot["x"]) / Cfg.TILE)), int(floor(float(spot["y"]) / Cfg.TILE)), true)
	return true


## 空投一座防御塔（opts.instant = 立即建成，测试与调试用）
func place_tower(mouse: Vector2, opts: Dictionary = {}) -> Dictionary:
	var def: Dictionary = _tower_defs.get(selected, {})
	if def.is_empty():
		return {}
	if towers.size() >= TowerMath.tower_cap(stats):
		return {}
	var spot = TowerMath.find_placement(world, mouse.x, mouse.y, ctx(true))
	if spot == null:
		return {}
	var instant := GdMath.truthy(opts.get("instant", false))
	var hp := TowerMath.tower_hp(def, stats)
	var t := {
		"id": towers.size() + 1,
		"type": selected,
		"def": def,
		"x": float(spot["x"]), "y": float(spot["y"]),
		"r": 18.0,
		"angle": -PI / 2.0,
		"level": 1,
		"hp": hp, "hpMax": hp,
		"armor": DataLoader.num_or(def, "armor", 4.0),
		"cd": 0.0 if instant else DataLoader.num_or(def, "buildTime", 3.0),
		"building": not instant,
		"buildProgress": 1.0 if instant else 0.0,
		"target": null,
		"kills": 0,
		"damageDealt": 0.0,
		"onPlatform": GdMath.truthy(spot["onPlatform"]),
	}
	towers.append(t)
	built += 1
	return t


func update(dt: float) -> void:
	_time += dt
	for t in towers:
		if GdMath.truthy(t["building"]):
			t["cd"] = maxf(0.0, float(t["cd"]) - dt)
			var total := DataLoader.num_or(t["def"], "buildTime", 3.0)
			t["buildProgress"] = 1.0 - float(t["cd"]) / maxf(0.001, total)
			if float(t["cd"]) <= 0.0:
				t["building"] = false
				t["buildProgress"] = 1.0
			continue
		_update_tower(t, dt)
	queue_redraw()


func _update_tower(t: Dictionary, dt: float) -> void:
	var def: Dictionary = t["def"]
	# 注意：局部变量**不能叫 range** —— 那会遮蔽 GDScript 内置的 range()，
	# 后面 `for i in range(...)` 之类的写法会报「float 与 Array 不能比较」。
	var atk_range := TowerMath.tower_range(def, stats)
	var target = t.get("target")
	if target != null and (GdMath.truthy(target.get("dead", false))
		or GdMath.dist(float(t["x"]), float(t["y"]), float(target["x"]), float(target["y"])) > atk_range):
		target = null
		t["target"] = null
	if target == null:
		target = _acquire_target(t, atk_range)
		t["target"] = target
	if target == null:
		return
	t["angle"] = GdMath.turn_toward(float(t["angle"]),
		GdMath.angle_to(float(t["x"]), float(t["y"]), float(target["x"]), float(target["y"])), dt * 6.0)
	t["cd"] = float(t.get("cd", 0.0)) - dt
	if float(t["cd"]) > 0.0:
		return
	t["cd"] = TowerMath.tower_cooldown(def, stats)
	_fire(t, target)


## 索敌：离基地最近 > 血量最高 > 最近（与 JS acquireTarget 同序）
func _acquire_target(t: Dictionary, atk_range: float) -> Variant:
	var best: Variant = null
	var best_score := -INF
	for e in enemies.enemies:
		if GdMath.truthy(e.get("dead", false)):
			continue
		var d := GdMath.dist(float(t["x"]), float(t["y"]), float(e["x"]), float(e["y"])) - float(e["r"])
		if d > atk_range:
			continue
		var base_d := 1.0e9
		for b in bases:
			base_d = minf(base_d, GdMath.dist(float(e["x"]), float(e["y"]), float(b["x"]), float(b["y"])))
		var score := -base_d * 1000.0 + float(e["hp"]) * 0.001 - d
		if score > best_score:
			best_score = score
			best = e
	return best


func _fire(t: Dictionary, target: Dictionary) -> void:
	var def: Dictionary = t["def"]
	var kind := DataLoader.str_of(def, "kind", "bullet")
	var dmg := TowerMath.tower_damage(def, stats, int(t["level"]))
	var a := GdMath.angle_to(float(t["x"]), float(t["y"]), float(target["x"]), float(target["y"]))
	match kind:
		"beam":
			# 光束：直接结算（JS 里也是即时命中）
			EnemyFactory.damage(target, dmg)
			t["damageDealt"] = float(t["damageDealt"]) + dmg
		"aura":
			for e in enemies.enemies:
				if GdMath.dist(float(t["x"]), float(t["y"]), float(e["x"]), float(e["y"])) > TowerMath.tower_range(def, stats):
					continue
				EnemyFactory.damage(e, dmg * 0.5)
		_:
			if projectiles != null:
				projectiles.spawn(float(t["x"]) + cos(a) * 20.0, float(t["y"]) + sin(a) * 20.0,
					a, DataLoader.num_or(def, "speed", 620.0), dmg,
					{ "color": Color(String(def.get("color", "#ffd98a"))), "r": 4.0, "life": 1.6 })


func tower_range_of(t: Dictionary) -> float:
	return TowerMath.tower_range(t["def"], stats)


func count() -> int:
	return towers.size()


func _draw() -> void:
	# 基地（核心舱）：**画在最下层**，塔与建筑叠在它上面。
	# 之前这里什么都没画 —— 世界生成放好了 baseSite、建造范围也以它为中心，
	# 但屏幕上看不见，玩家的原话就是「我的基地呢」。
	for b in bases:
		BaseRenderer.draw_base(self, b, _time, float(b.get("buildRadius", 520.0)),
			_base_under_attack())
	# 建造预览
	if _preview != null:
		var pos := Vector2(float(_preview["x"]), float(_preview["y"]))
		var col := Color(0.43, 0.9, 0.66, 0.9) if _preview_valid else Color(1, 0.37, 0.43, 0.9)
		draw_arc(pos, 22.0, 0, TAU, 24, col, 2.0)
		if GdMath.truthy(_preview["onPlatform"]):
			draw_arc(pos, 26.0, 0, TAU, 24, Color(0.43, 0.9, 0.66, 0.5), 2.0)
			draw_string(ThemeDB.fallback_font, pos + Vector2(-24, -30), "基座：免间隔",
				HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(0.43, 0.9, 0.66))
	# 建筑（基座等）
	for s in structures:
		var p := Vector2(float(s["x"]), float(s["y"]))
		draw_rect(Rect2(p - Vector2(19, 19), Vector2(38, 38)), Color("#6a7280"))
		draw_rect(Rect2(p - Vector2(19, 19), Vector2(38, 38)), Color("#39414d"), false, 2.0)
		draw_circle(p, 5.0, Color("#59d8ff"))
	# 塔
	for t in towers:
		var p := Vector2(float(t["x"]), float(t["y"]))
		if GdMath.truthy(t["building"]):
			var prog := clampf(float(t["buildProgress"]), 0.0, 1.0)
			draw_arc(p, 26.0, 0, TAU, 24, Color(0.56, 0.88, 1.0, 0.45), 2.0)
			draw_rect(Rect2(p - Vector2(16, 22 - 220 * (1 - prog * prog)), Vector2(32, 40)), Color("#5a7a94"))
			draw_rect(Rect2(p.x - 30, p.y - 44, 60, 5), Color(0, 0, 0, 0.5))
			draw_rect(Rect2(p.x - 29, p.y - 43, 58 * prog, 3), Color("#8fe0ff"))
			continue
		draw_circle(p + Vector2(0, 3), 20.0, Color(0, 0, 0, 0.25))
		var tex := Sprites.tower_tex(String(t["type"]))
		var a := float(t["angle"])
		if tex != null:
			# 有贴图：底座圆盘保留（能看出射程归属），炮塔本体贴图，再叠炮管表示朝向
			draw_circle(p, 19.0, Color("#38414f"))
			draw_circle(p, 19.0, Color("#6a7788") if not GdMath.truthy(t["onPlatform"]) else Color("#6ee7a8"), false, 2.0)
			Sprites.draw_centered(self, tex, p, 34.0)
			draw_line(p + Vector2(cos(a), sin(a)) * 6.0, p + Vector2(cos(a), sin(a)) * 21.0,
				Color(0.9, 0.94, 1.0, 0.85), 3.0)
		else:
			draw_circle(p, 19.0, Color("#38414f"))
			draw_circle(p, 19.0, Color("#6a7788") if not GdMath.truthy(t["onPlatform"]) else Color("#6ee7a8"), false, 2.0)
			draw_line(p, p + Vector2(cos(a), sin(a)) * 22.0, Color("#c9d4e0"), 5.0)
		if GdMath.truthy(t["onPlatform"]):
			draw_circle(p + Vector2(0, 12), 2.6, Color("#6ee7a8"))
		var frac := clampf(float(t["hp"]) / maxf(1.0, float(t["hpMax"])), 0.0, 1.0)
		if frac < 0.999:
			draw_rect(Rect2(p.x - 20, p.y - 30, 40, 4), Color(0, 0, 0, 0.55))
			draw_rect(Rect2(p.x - 19, p.y - 29, 38 * frac, 2), Color("#6ee7a8"))


## 基地是不是正在挨打（用来把核心舱描边变红）
func _base_under_attack() -> bool:
	if player == null:
		return false
	for b in bases:
		for e in (enemies.enemies if enemies != null else []):
			if GdMath.truthy(e.get("dead", false)):
				continue
			if GdMath.dist(float(e["x"]), float(e["y"]), float(b["x"]), float(b["y"])) < 140.0:
				return true
	return false