## 弹丸系统 —— `src/systems/projectiles.js` 的移植（阶段 5 先做玩家弹道）。
##
## 与 JS 一致的关键点：
##   - 弹丸按**子步**推进（速度高时不会穿过薄墙）；
##   - 撞地形用 `world.circle_blocked`（与角色同一套判定）；
##   - 敌人弹丸 `friendly = false`，玩家弹丸为 true。
##
## 敌人与伤害结算在阶段 6 接上；这一轮先把「打出去、撞墙消失、拖尾」跑通。
extends Node2D

const MAX_SUBSTEP := 12.0

var world: GdWorld
var projectiles: Array = []
## 命中判定回调（由 Enemies 提供：hit_test(x, y, r, damage) -> bool）
var hit_test: Callable = Callable()
var hits := 0


func setup(p_world: GdWorld, p_hit_test: Callable = Callable()) -> void:
	world = p_world
	hit_test = p_hit_test


func spawn(x: float, y: float, angle: float, speed: float, damage: float, opts: Dictionary = {}) -> void:
	projectiles.append({
		"x": x, "y": y,
		"vx": cos(angle) * speed, "vy": sin(angle) * speed,
		"r": float(opts.get("r", 5.0)),
		"damage": damage,
		"friendly": GdMath.truthy(opts.get("friendly", true)),
		"life": float(opts.get("life", 2.2)),
		"color": opts.get("color", Color("#ffd98a")),
		"pierce": int(opts.get("pierce", 0)),
		"hit": {},
	})


func update(dt: float) -> void:
	if world == null:
		return
	var alive: Array = []
	for p in projectiles:
		p["life"] = float(p["life"]) - dt
		if float(p["life"]) <= 0.0:
			continue
		# 子步推进：一步最多走 MAX_SUBSTEP 像素，避免高速穿墙
		var dist := sqrt(p["vx"] * p["vx"] + p["vy"] * p["vy"]) * dt
		var steps := maxi(1, int(ceil(dist / MAX_SUBSTEP)))
		var dead := false
		for _i in steps:
			p["x"] = float(p["x"]) + float(p["vx"]) * dt / float(steps)
			p["y"] = float(p["y"]) + float(p["vy"]) * dt / float(steps)
			if world.circle_blocked(float(p["x"]), float(p["y"]), float(p["r"]) * 0.6):
				dead = true
				break
			# 命中判定：只对「玩家打怪」这一侧做（怪打玩家在 enemies 里结算）
			if GdMath.truthy(p["friendly"]) and hit_test.is_valid():
				if GdMath.truthy(hit_test.call(float(p["x"]), float(p["y"]), float(p["r"]), float(p["damage"]))):
					hits += 1
					var pierced := int(p.get("pierce", 0))
					if pierced <= 0:
						dead = true
						break
					p["pierce"] = pierced - 1
		if dead:
			# 撞墙/命中：留一点火花（与 JS 的 spark 特效同义）
			_sparks(float(p["x"]), float(p["y"]), p["color"])
			continue
		alive.append(p)
	projectiles = alive
	queue_redraw()


var _spark_list: Array = []

func _sparks(x: float, y: float, color: Color) -> void:
	_spark_list.append({ "x": x, "y": y, "life": 0.18, "max": 0.18, "color": color })


func _process(dt: float) -> void:
	if _spark_list.is_empty():
		return
	var kept: Array = []
	for s in _spark_list:
		s["life"] = float(s["life"]) - dt
		if float(s["life"]) > 0.0:
			kept.append(s)
	_spark_list = kept
	queue_redraw()


func _draw() -> void:
	for s in _spark_list:
		var a := float(s["life"]) / float(s["max"])
		draw_circle(Vector2(float(s["x"]), float(s["y"])), 3.0 + 6.0 * (1.0 - a),
			Color(s["color"].r, s["color"].g, s["color"].b, a * 0.8))
	for p in projectiles:
		var pos := Vector2(float(p["x"]), float(p["y"]))
		var dir := Vector2(float(p["vx"]), float(p["vy"])).normalized()
		# 弹丸本体 + 一小段拖尾（JS 版也是「亮点 + 拖尾」的画法）
		draw_line(pos - dir * 14.0, pos, Color(p["color"].r, p["color"].g, p["color"].b, 0.35), 3.0)
		draw_circle(pos, float(p["r"]), p["color"])
		draw_circle(pos, float(p["r"]) * 0.5, Color(1, 1, 1, 0.9))


func count() -> int:
	return projectiles.size()
