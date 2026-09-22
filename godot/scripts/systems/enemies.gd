## 怪物系统 —— `src/systems/enemies.js` 的移植（阶段 6 第一批：追击 + 攻击 + 受击 + 掉落）。
##
## 这一批刻意只做「能打起来」的最小闭环，但每一条都照搬 JS 的规则：
##   - 数值来自 `EnemyFactory`（已黄金对比）；
##   - 移动用移植后的 `try_move`（逐轴贴墙滑行）；
##   - 卡墙自救（1.2 秒没位移就挪到最近空地）—— 玩家报过「怪被地形卡住」；
##   - 远程怪保持距离、近战怪贴脸；
##   - 死亡掉落：弹药 5~15 发（整数）+ 经验/金币进账。
##
## 流场：JS 是「目标变化时重算一次，全场共享」。GDScript 里世界生成要 4.9 秒、
## 流场也要几百毫秒，所以这里按「玩家移动超过 4 格才重算」来节流，
## 近距离（600px 内）直接朝玩家走。
extends Node2D

const MELEE_REACH_PAD := 6.0
const DIRECT_RANGE := 600.0
const FLOW_REFRESH_TILES := 4

var world: GdWorld
var player: Node2D
var projectiles: Node2D

var enemies: Array = []
var kills := 0
var xp_total := 0
var gold_total := 0
var ammo_dropped := 0

var _flow: FlowField = null
## 异步流场：重算走后台线程（100ms 的冻结就是这么消掉的）
var _async_flow: AsyncFlow = null
var _flow_goal := Vector2i(-9999, -9999)
var _types: Array = []
var _last_flow_ms := 0
var _flow_calls := 0
## 分帧预算：流场重算是 90ms 级操作，不能在连续移动时连环触发
var budget: FrameBudget = null


func setup(p_world: GdWorld, p_player: Node2D, p_projectiles: Node2D) -> void:
	world = p_world
	player = p_player
	projectiles = p_projectiles
	var defs: Dictionary = DataLoader.new().table("monsters", "MONSTER_DEF", {})
	for k in defs.keys():
		var d: Dictionary = defs[k]
		if GdMath.truthy(d.get("boss", false)):
			continue
		_types.append(d)


func spawn(monster_def: Dictionary, x: float, y: float, opts: Dictionary = {}) -> Dictionary:
	var e := EnemyFactory.create(world.rng, monster_def, x, y, opts)
	if e.is_empty():
		return {}
	# 出生朝向：副本里朝玩家，否则朝基地（与 JS 同义；这里没有基地，统一朝玩家）
	e["angle"] = GdMath.angle_to(x, y, player.position.x, player.position.y)
	enemies.append(e)
	return e


## 在玩家附近撒一波（阶段 8 的波次系统会接管这件事）
func spawn_around(count: int, radius_min: float, radius_max: float, tier: int = 1) -> void:
	if _types.is_empty():
		return
	for i in count:
		var a := randf() * TAU
		var r := randf_range(radius_min, radius_max)
		var spot := world.find_open_spot(player.position.x + cos(a) * r, player.position.y + sin(a) * r, 200.0)
		var def: Dictionary = _types[randi() % _types.size()]
		spawn(def, float(spot["x"]), float(spot["y"]), { "tier": tier })


func update(dt: float) -> void:
	_update_flow(dt)
	# 敌人彼此分离，避免叠成一个点（JS 的 separation）
	_separate(dt)
	for e in enemies:
		if GdMath.truthy(e.get("dead", false)):
			continue
		_update_enemy(e, dt)
	# 击杀结算：统一在这里做，避免在遍历中改数组
	var alive: Array = []
	for e in enemies:
		if GdMath.truthy(e.get("dead", false)):
			_on_killed(e)
		else:
			alive.append(e)
	enemies = alive
	queue_redraw()


func _update_flow(_dt: float) -> void:
	if player == null:
		return
	if budget == null:
		budget = FrameBudget.new()
	budget.tick(_dt)
	var goal := Vector2i(int(player.position.x / Cfg.TILE), int(player.position.y / Cfg.TILE))
	if _async_flow == null:
		_async_flow = AsyncFlow.new()
		_flow = _async_flow.field()
		_async_flow.request(goal, world.tiles)      # 开局先在后台算一份
		_flow_goal = goal
		return
	# 先收结果（算完就换到前台，O(1)）
	_async_flow.poll()
	_flow = _async_flow.field()
	_flow_calls = _async_flow.compute_count
	_last_flow_ms = _async_flow.last_ms()
	if absi(goal.x - _flow_goal.x) < FLOW_REFRESH_TILES \
		and absi(goal.y - _flow_goal.y) < FLOW_REFRESH_TILES:
		return
	# 目标变了 → 交给后台算；主线程继续用旧的那份，一点都不卡
	_flow_goal = goal
	_async_flow.request(goal, world.tiles)


func _update_enemy(e: Dictionary, dt: float) -> void:
	var def: Dictionary = e["def"]
	if float(e.get("hitFlash", 0.0)) > 0.0:
		e["hitFlash"] = maxf(0.0, float(e["hitFlash"]) - dt * 4.0)
	if float(e.get("spawnAnim", 0.0)) > 0.0:
		e["spawnAnim"] = maxf(0.0, float(e["spawnAnim"]) - dt)
	if float(e.get("stun", 0.0)) > 0.0:
		e["stun"] = float(e["stun"]) - dt
		return

	# Boss：技能组优先（预警中停手、冲撞中位移）
	if GdMath.truthy(e.get("boss", false)) and e.has("abilities"):
		_update_boss(e, dt)
		if e.get("casting") != null or e.get("dash") != null:
			return
	var px := player.position.x
	var py := player.position.y
	var d := GdMath.dist(float(e["x"]), float(e["y"]), px, py)
	# 速度走 Status.speed_of（含减速/遁地/地形，与 JS 同式）
	var speed := Status.speed_of(e, world)
	var reach := float(def.get("attackRange", 26.0)) + float(e["r"]) + MELEE_REACH_PAD
	var want_range := float(def.get("attackRange", 26.0))

	if GdMath.truthy(def.get("ranged", false)) and d < float(def.get("keepDist", 200.0)) * 0.7:
		# 远程怪太近了：后退
		var a := GdMath.angle_to(px, py, float(e["x"]), float(e["y"]))
		_step(e, cos(a) * speed * dt, sin(a) * speed * dt)
	elif d > reach:
		var dx := 0.0
		var dy := 0.0
		if d <= DIRECT_RANGE or _flow == null:
			dx = (px - float(e["x"])) / maxf(1.0, d)
			dy = (py - float(e["y"])) / maxf(1.0, d)
			# 玩家反馈「有些怪寻路会走最短的直线，会卡在地形上」——
			# 近距离/没有流场时原来是**无条件直走**，一堵墙就顶上去。
			# 现在先探一下前方：走不通就换成贪心绕行。
			var probe := float(e["r"]) + 10.0
			if world.circle_blocked(float(e["x"]) + dx * probe, float(e["y"]) + dy * probe, float(e["r"]) * 0.8):
				var fb0 := _fallback_dir(e, px, py)
				dx = float(fb0["x"])
				dy = float(fb0["y"])
		else:
			var s := _flow.sample(float(e["x"]), float(e["y"]))
			if GdMath.truthy(s["ok"]) and (absf(float(s["x"])) > 0.001 or absf(float(s["y"])) > 0.001):
				dx = float(s["x"])
				dy = float(s["y"])
			else:
				# 流场用不了（贴墙/不可达）：绝不放直线，先找能走的方向
				var fb := _fallback_dir(e, px, py)
				dx = float(fb["x"])
				dy = float(fb["y"])
		# 侧翼：斜着绕过去（JS 的 flankAngle）
		if float(def.get("flank", 0.0)) > 0.0:
			var fa := atan2(dy, dx) + float(e["flankAngle"])
			dx = cos(fa)
			dy = sin(fa)
		_step(e, dx * speed * dt, dy * speed * dt)
		_unstick(e, dt)
	else:
		e["attackCd"] = float(e.get("attackCd", 0.0)) - dt
		if float(e["attackCd"]) <= 0.0:
			e["attackCd"] = float(def.get("attackCd", 1.2))
			_attack(e, def, d, want_range)


func _step(e: Dictionary, dx: float, dy: float) -> void:
	var r := world.try_move(float(e["x"]), float(e["y"]), float(e["r"]), dx, dy, GdMath.truthy(e["def"].get("flying", false)))
	e["x"] = float(r["x"])
	e["y"] = float(r["y"])
	if dx != 0.0 or dy != 0.0:
		e["angle"] = GdMath.turn_toward(float(e["angle"]), atan2(dy, dx), 0.12)


## 贴墙绕行（与 JS moveAlongFlow 的兜底同一套）
func _fallback_dir(e: Dictionary, tx: float, ty: float) -> Dictionary:
	var want := GdMath.angle_to(float(e["x"]), float(e["y"]), tx, ty)
	var probe := float(e["r"]) + 12.0
	var best_a := want
	var best_score := -INF
	for i in 8:
		var off := float((i + 1) / 2) * (PI / 4.0) * (1.0 if i % 2 == 1 else -1.0)
		var a := want + off
		var px := float(e["x"]) + cos(a) * probe
		var py := float(e["y"]) + sin(a) * probe
		if world.circle_blocked(px, py, float(e["r"]) * 0.8):
			continue
		var score := cos(off) - absf(off) * 0.05
		if score > best_score:
			best_score = score
			best_a = a
	return { "x": cos(best_a), "y": sin(best_a) }


## 卡墙自救：连续 1.2 秒几乎没位移就挪到最近的可通行点
func _unstick(e: Dictionary, dt: float) -> void:
	if GdMath.truthy(e["def"].get("flying", false)):
		return
	if not e.has("_sx"):
		e["_sx"] = e["x"]
		e["_sy"] = e["y"]
		e["_stuckT"] = 0.0
	var moved := GdMath.dist(float(e["x"]), float(e["y"]), float(e["_sx"]), float(e["_sy"]))
	if moved > float(e["r"]) * 0.6:
		e["_sx"] = e["x"]
		e["_sy"] = e["y"]
		e["_stuckT"] = 0.0
		return
	e["_stuckT"] = float(e["_stuckT"]) + dt
	if float(e["_stuckT"]) > 1.2:
		# 玩家要求：「卡住后也不要突然刷新到基地附近，直接消失掉重新刷就好了」。
		# 原来用 find_open_spot 就近挪 —— 挪不出去时会落到更远处，
		# 看起来就像凭空出现在基地旁边。现在改成退场，由波次按正常节奏补一只。
		e["dead"] = true
		e["despawnReason"] = "stuck"
		e["_stuckT"] = 0.0


func _separate(dt: float) -> void:
	# 极简分离：两两比较（怪物数量小；规模上去后换空间哈希，见阶段 6 后续）
	for i in enemies.size():
		var a: Dictionary = enemies[i]
		for j in range(i + 1, enemies.size()):
			var b: Dictionary = enemies[j]
			var dx := float(b["x"]) - float(a["x"])
			var dy := float(b["y"]) - float(a["y"])
			var min_d := float(a["r"]) + float(b["r"])
			var d2 := dx * dx + dy * dy
			if d2 > min_d * min_d or d2 <= 0.0001:
				continue
			var d := sqrt(d2)
			var push := (min_d - d) * 0.5
			var nx := dx / d
			var ny := dy / d
			a["x"] = float(a["x"]) - nx * push * dt * 6.0
			a["y"] = float(a["y"]) - ny * push * dt * 6.0
			b["x"] = float(b["x"]) + nx * push * dt * 6.0
			b["y"] = float(b["y"]) + ny * push * dt * 6.0


func _attack(e: Dictionary, def: Dictionary, d: float, want_range: float) -> void:
	if GdMath.truthy(def.get("ranged", false)) and projectiles != null:
		var rd: Dictionary = def.get("ranged", {})
		var a := GdMath.angle_to(float(e["x"]), float(e["y"]), player.position.x, player.position.y)
		var speed := float(rd.get("speed", 300.0))
		projectiles.spawn(float(e["x"]) + cos(a) * (float(e["r"]) + 4.0),
			float(e["y"]) + sin(a) * (float(e["r"]) + 4.0), a, speed,
			float(e["dmg"]), { "friendly": false, "r": float(rd.get("r", 8.0)), "color": Color("#b080ff") })
		return
	if d <= want_range + float(e["r"]) + MELEE_REACH_PAD and player.has_method("take_damage"):
		player.take_damage(float(e["dmg"]), String(def.get("name", "怪物")))


func _on_killed(e: Dictionary) -> void:
	kills += 1
	xp_total += int(round(float(e["xpValue"])))
	gold_total += int(round(float(e["goldValue"])))
	# 弹药掉落：与 JS 一致是 5~15 发整数
	var drop := randi_range(5, 15)
	ammo_dropped += drop
	if player.loadout != null:
		player.loadout.ammo = mini(player.loadout.ammo_max, player.loadout.ammo + drop)


## 玩家弹丸命中判定（由 ProjectileSystem 每帧调用）
func hit_test(x: float, y: float, r: float, damage: float) -> bool:
	for e in enemies:
		if GdMath.truthy(e.get("dead", false)):
			continue
		var rr := r + float(e["r"])
		var dx := float(e["x"]) - x
		var dy := float(e["y"]) - y
		if dx * dx + dy * dy > rr * rr:
			continue
		EnemyFactory.damage(e, damage)
		return true
	return false


func count() -> int:
	return enemies.size()


## Boss 预警：红色感叹号 + 冲撞走廊（玩家要求过的那条「红感叹号预警后的冲撞」）
func _draw_telegraph(pos: Vector2, e: Dictionary) -> void:
	var c = e.get("casting")
	if c is Dictionary:
		var ab: Dictionary = c["ab"]
		var warn := maxf(0.01, float(ab.get("warn", 1.0)))
		var k := GdMath.clampf01(1.0 - float(c["t"]) / warn)      # 蓄力进度
		var dist := float(ab.get("dist", 520.0))
		var half := float(ab.get("halfWidth", 54.0))
		# 冲撞走廊：告诉玩家「往哪边躲」
		var dir := Vector2(cos(float(c["angle"])), sin(float(c["angle"])))
		var perp := Vector2(-dir.y, dir.x)
		var pts := PackedVector2Array([
			pos + perp * half, pos + dir * dist + perp * half,
			pos + dir * dist - perp * half, pos - perp * half])
		draw_colored_polygon(pts, Color(1.0, 0.25, 0.31, 0.10 + k * 0.16))
		draw_line(pos + perp * half, pos + dir * dist + perp * half, Color(1.0, 0.25, 0.31, 0.3 + k * 0.5), 2.0)
		draw_line(pos - perp * half, pos + dir * dist - perp * half, Color(1.0, 0.25, 0.31, 0.3 + k * 0.5), 2.0)
		# 头顶红色感叹号（越大越接近发动）
		var y := pos.y - float(e["r"]) - 30.0 + sin(Time.get_ticks_msec() * 0.024) * 3.0 * k
		var s := 1.0 + k * 0.5
		draw_rect(Rect2(pos.x - 6.0 * s, y - 16.0 * s, 12.0 * s, 22.0 * s), Color(1.0, 0.25, 0.31))
		draw_rect(Rect2(pos.x - 6.0 * s, y - 16.0 * s, 12.0 * s, 22.0 * s), Color(0, 0, 0, 0.65), false, 2.0)
		draw_circle(Vector2(pos.x, y + 12.0 * s), 4.4 * s, Color(1.0, 0.25, 0.31))
	if e.get("dash") != null:
		var d: Dictionary = e["dash"]
		var back := Vector2(float(d["x"]), float(d["y"])) * -30.0
		draw_circle(pos + back, float(e["r"]) * 1.1, Color(1.0, 0.37, 0.43, 0.35))


func _draw() -> void:
	# 先画预警（画在怪下面，别挡住本体）；只有 Boss 有技能预警
	for e in enemies:
		if GdMath.truthy(e.get("boss", false)):
			_draw_telegraph(Vector2(float(e["x"]), float(e["y"])), e)
	for e in enemies:
		var pos := Vector2(float(e["x"]), float(e["y"]))
		var def: Dictionary = e["def"]
		var base := Color(String(def.get("color", "#c05a5a")))
		var a := float(e["angle"])
		if GdMath.truthy(e.get("elite", false)):
			base = base.lerp(Color("#ffba4c"), 0.35)
		var r := float(e["r"])
		var tex := Sprites.enemy_tex(String(def.get("id", e.get("kind", "?"))))
		# 影子（贴图和色块都画）
		draw_circle(pos + Vector2(0, r * 0.25), r * 1.05, Color(0, 0, 0, 0.22))
		if tex != null:
			# 有贴图就贴图：按世界里的半径缩放（贴图里朝向是"上"，所以旋转 90° 对齐朝向）
			var s := tex.get_size()
			var k := r * 2.4 / maxf(s.x, s.y)
			var sz := s * k
			draw_set_transform(pos, a + PI / 2.0, Vector2.ONE)
			draw_texture_rect(tex, Rect2(-sz / 2.0, sz), false,
				Color(1, 1, 1, 1) if not GdMath.truthy(e.get("elite", false)) else Color(1.0, 0.85, 0.6))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		else:
			# 没贴图退回程序化：身体 + 朝向楔形（与 JS 的画法同构）
			draw_circle(pos, r, base)
			draw_circle(pos, r * 0.62, base.lightened(0.25))
			draw_colored_polygon(PackedVector2Array([
				pos + Vector2(cos(a), sin(a)) * (r + 5.0),
				pos + Vector2(cos(a + 2.5), sin(a + 2.5)) * (r * 0.8),
				pos + Vector2(cos(a - 2.5), sin(a - 2.5)) * (r * 0.8),
			]), base.darkened(0.25))
		if float(e.get("hitFlash", 0.0)) > 0.0:
			draw_circle(pos, r * 1.1, Color(1, 1, 1, float(e["hitFlash"]) * 0.5))
		var frac := clampf(float(e["hp"]) / maxf(1.0, float(e["hpMax"])), 0.0, 1.0)
		if frac < 0.999:
			var w := maxf(20.0, r * 1.8)
			draw_rect(Rect2(pos.x - w / 2.0, pos.y - r - 10.0, w, 4.0), Color(0, 0, 0, 0.55))
			draw_rect(Rect2(pos.x - w / 2.0 + 1.0, pos.y - r - 9.0, (w - 2.0) * frac, 2.0), Color("#ff5f6d"))


## 副本 Boss（阶段 6 的三件套：预警冲撞 / 弹幕 / 召唤）
func spawn_dungeon_boss(tier: int, x: float, y: float) -> Dictionary:
	var defs: Dictionary = DataLoader.new().table("monsters", "MONSTER_DEF", {})
	# 与 JS 一致：65% 巢穴吞噬者 / 35% 虚空女妖
	var boss_type: String = "nestDevourer" if world.rng.chance(0.65) else "voidSiren"
	var d: Dictionary = defs.get(boss_type, {})
	if d.is_empty():
		for k in defs.keys():
			if GdMath.truthy(defs[k].get("boss", false)):
				d = defs[k]
				break
	if d.is_empty():
		return {}
	var scale := BossKit.boss_scale(world.planet_index, tier)
	var e: Dictionary = EnemyFactory.create(world.rng, d, x, y, { "tier": mini(10, tier), "scale": scale, "boss": true, "elite": true })
	if e.is_empty():
		return {}
	e["role"] = "boss"
	e["dungeonBoss"] = true
	e["homeX"] = x
	e["homeY"] = y
	e["xpValue"] = float(e["xpValue"]) * 2.0
	e["goldValue"] = float(e["goldValue"]) * 2.0
	e["abilities"] = BossKit.abilities_for(tier)
	BossKit.seed_cooldowns(world.rng, e["abilities"])
	enemies.append(e)
	return e


## 副本常驻守军：每间侧室 1~2 只 + 主通道 2 + tier/3 只（固定数量）
func spawn_dungeon_garrison(tier: int) -> int:
	if world.dungeon == null:
		return 0
	var d: Dictionary = world.dungeon
	var n := 0
	var chambers: Array = d["chambers"]
	var per := 2 if tier >= 7 else 1
	for ch in chambers:
		for k in per:
			var a := world.rng.next_f() * TAU
			var spot: Dictionary = world.find_open_spot(float(ch["x"]) + cos(a) * 70.0, float(ch["y"]) + sin(a) * 70.0, 120.0)
			if _spawn_guard(float(spot["x"]), float(spot["y"]), tier):
				n += 1
	var corridor := 2 + int(floor(float(tier) / 3.0))
	for i in corridor:
		var tx := float(d["entry"]["x"]) + 340.0 + float(i) * 190.0
		if tx > float(d["boss"]["x"]) - 160.0:
			break
		var spot2: Dictionary = world.find_open_spot(tx, float(d["entry"]["y"]) + (34.0 if i % 2 == 1 else -34.0), 140.0)
		if _spawn_guard(float(spot2["x"]), float(spot2["y"]), tier):
			n += 1
	return n


func _spawn_guard(x: float, y: float, tier: int) -> bool:
	var pool: Array = []
	for t in _roster("base"):
		pool.append([t, 26])
	for t in _roster("mid"):
		pool.append([t, 20])
	if tier >= 4:
		for t in _roster("high"):
			pool.append([t, 16])
	if tier >= 7:
		for t in _roster("special"):
			pool.append([t, 6])
	var type: Variant = world.rng.weighted(pool)
	if type == null:
		return false
	var defs: Dictionary = DataLoader.new().table("monsters", "MONSTER_DEF", {})
	var d: Dictionary = defs.get(String(type), {})
	if d.is_empty():
		return false
	var e: Dictionary = EnemyFactory.create(world.rng, d, x, y, { "tier": mini(10, tier),
		"scale": EnemyFactory.scale_for(world.planet_index, tier, 1.0) })
	if e.is_empty():
		return false
	e["role"] = "guard"
	e["dungeonGuard"] = true
	e["homeX"] = x
	e["homeY"] = y
	enemies.append(e)
	return true


func _roster(key: String) -> Array:
	var r: Variant = DataLoader.new().module("monsters").get("NEST_ROSTER", {})
	if r is Dictionary:
		var rd: Dictionary = r
		return rd.get(key, [])
	return []


## Boss 技能推进（预警 → 冲撞 / 弹幕 / 召唤）
func _update_boss(e: Dictionary, dt: float) -> void:
	# 预警中：停手等时间到
	if e.get("casting") != null:
		BossKit.update_cast(e, dt)
		return
	if e.get("dash") != null:
		var res := BossKit.update_dash(e, dt, world, player, towers_ref)
		if GdMath.truthy(res.get("hitPlayer", false)):
			bus_shake(10.0)
		return
	# 弹幕推进
	var shots := BossKit.update_barrage(e, dt)
	for s in shots:
		if projectiles != null:
			projectiles.spawn(float(e["x"]) + cos(float(s["angle"])) * (float(e["r"]) + 4.0),
				float(e["y"]) + sin(float(s["angle"])) * (float(e["r"]) + 4.0),
				float(s["angle"]), float(s["speed"]), float(s["damage"]),
				{ "friendly": false, "r": 9.0, "color": Color("#ff7a4c"), "life": 3.2 })
	# 技能冷却
	var abilities: Array = e.get("abilities", [])
	for ab in abilities:
		ab["t"] = float(ab["t"]) - dt
		if float(ab["t"]) > 0.0:
			continue
		ab["t"] = float(ab["cd"])
		match String(ab["kind"]):
			"charge":
				BossKit.begin_cast(e, ab, player.position.x, player.position.y)
				print("[godot] %s 起手冲撞（红色感叹号预警 %.1fs）" % [String(e["def"].get("name", "Boss")), float(ab["warn"])])
			"barrage":
				BossKit.begin_barrage(e, ab, player.position.x, player.position.y)
			"summonAdds":
				var live := 0
				for o in enemies:
					if GdMath.truthy(o.get("summoned", false)) and not GdMath.truthy(o.get("dead", false)):
						live += 1
				var want := BossKit.summon_count(ab, live)
				for i in want:
					var a := world.rng.next_f() * TAU
					var spot: Dictionary = world.find_open_spot(float(e["x"]) + cos(a) * 110.0, float(e["y"]) + sin(a) * 110.0, 180.0)
					if not _types.is_empty():
						var add: Dictionary = EnemyFactory.create(world.rng, _types[world.rng.range_i(0, _types.size() - 1)],
							float(spot["x"]), float(spot["y"]),
							{ "tier": int(e["tier"]), "scale": e["scale"], "summoned": true })
						if not add.is_empty():
							add["role"] = "wave"
							enemies.append(add)
				if want > 0:
					print("[godot] Boss 召唤了 %d 只增援" % want)


var towers_ref: Array = []

## 震屏：接到相机的 CameraRig 上（以前这里是空函数，于是挨打/Boss 冲撞/基地被砸
## 在 Godot 版里一点反馈都没有）
var cam_rig_ref: CameraRig = null


func bus_shake(mag: float, time: float = CameraRig.DEFAULT_SHAKE_TIME) -> void:
	if cam_rig_ref != null:
		cam_rig_ref.shake(mag, time)

