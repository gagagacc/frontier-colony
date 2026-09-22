## 可采集物的绘制 + 采集交互（阶段 11 的「采集」补齐）
##
## 绘制沿用 JS 的程序化风格：按 PROP_DEF 的 shape 画不同形状
## （灌木圆丛 / 树 / 岩石 / 晶簇 / 残骸方块…），再按 variant 做微变化。
## 采集：按住 E，进度环 + 每 0.6 秒跳一次 +N 飘字。
extends Node2D

const HARVEST_RANGE := Props.HARVEST_RANGE

var world: GdWorld
var props: Props
var player: Node2D
var stats: StatSet

var holding := false
var target: Variant = null
var chips: Array = []            # 飘字 { x, y, life, text, color }
var resources: Dictionary = {}
var harvested_count := 0
var chips_paid := 0.0            # 距离下一次小块结算还有多久
var tool_tag := "pick"
var budget: FrameBudget = null           # 由玩家当前武器 subtype 决定（阶段 5 的接线）


func setup(p_world: GdWorld, p_props: Props, p_player: Node2D, p_stats: StatSet) -> void:
	world = p_world
	props = p_props
	player = p_player
	stats = p_stats


func update(dt: float, e_held: bool, e_tapped: bool) -> void:
	if world == null or props == null:
		return
	# 分帧生成：一帧最多补 1 个区块，避免走路时一帧做完一批导致掉帧
	if budget == null:
		budget = FrameBudget.new()
	budget.tick(dt)
	budget.pump_chunks(props, player.position.x, player.position.y, 1400.0)
	if not e_held and not e_tapped:
		target = null
		holding = false
	else:
		holding = true
		if target == null or GdMath.truthy(target.get("dead", false)) \
			or GdMath.dist(player.position.x, player.position.y, float(target["x"]), float(target["y"])) > HARVEST_RANGE:
			target = props.nearest(player.position.x, player.position.y, HARVEST_RANGE)
		if target != null:
			var res := props.harvest_tick(target, dt, stats, tool_tag)
			chips_paid += dt
			if chips_paid >= Props.CHIP_INTERVAL:
				chips_paid = 0.0
				_pay_chip(target)
			if GdMath.truthy(res.get("complete", false)):
				var yields := props.harvest_complete(target)
				for k in yields.keys():
					resources[k] = int(resources.get(k, 0)) + int(yields[k])
				harvested_count += 1
				_popup(float(target["x"]), float(target["y"]) - 18.0,
					"采集完成", Color("#6ee7a8"))
				target = null
	# 飘字推进
	var kept: Array = []
	for c in chips:
		c["life"] = float(c["life"]) - dt
		c["y"] = float(c["y"]) - dt * 26.0
		if float(c["life"]) > 0.0:
			kept.append(c)
	chips = kept
	queue_redraw()


## 每小块结算：随机挑一种产出 +1（与 JS 的「一点一点跳」同义）
func _pay_chip(prop: Dictionary) -> void:
	var def := props.def_of(String(prop["type"]))
	var yields: Dictionary = def.get("yield", {})
	var keys: Array = []
	for k in yields.keys():
		var pair: Array = yields[k]
		if float(pair[1]) > 0.0:
			keys.append(String(k))
	if keys.is_empty():
		return
	var pick_key: String = keys[randi() % keys.size()]
	resources[pick_key] = int(resources.get(pick_key, 0)) + 1
	_popup(float(prop["x"]) + randf_range(-10.0, 10.0), float(prop["y"]) - 12.0,
		"+1 %s" % pick_key, Color("#ffd98a"))


func _popup(x: float, y: float, text: String, color: Color) -> void:
	chips.append({ "x": x, "y": y, "life": 1.1, "max": 1.1, "text": text, "color": color })


func _draw() -> void:
	if props == null:
		return
	var view := Rect2(player.position - Vector2(760, 460), Vector2(1520, 920))
	for id in props.props.keys():
		var p: Dictionary = props.props[id]
		if float(p["x"]) < view.position.x or float(p["x"]) > view.end.x:
			continue
		if float(p["y"]) < view.position.y or float(p["y"]) > view.end.y:
			continue
		_draw_prop(p)
	# 采集进度环
	if target != null and not GdMath.truthy(target.get("dead", false)):
		var pos := Vector2(float(target["x"]), float(target["y"]))
		var frac := 1.0 - GdMath.clampf01(float(target["hp"]) / maxf(1.0, float(target["maxHp"])))
		draw_arc(pos, float(target["r"]) + 10.0, -PI / 2.0, -PI / 2.0 + TAU * frac, 28,
			Color(1.0, 0.85, 0.35, 0.9), 3.0)
	# 飘字
	for c in chips:
		var a := float(c["life"]) / float(c["max"])
		draw_string(ThemeDB.fallback_font, Vector2(float(c["x"]) - 16.0, float(c["y"])),
			String(c["text"]), HORIZONTAL_ALIGNMENT_LEFT, -1, 14,
			Color(c["color"].r, c["color"].g, c["color"].b, a))


func _draw_prop(p: Dictionary) -> void:
	var def := props.def_of(String(p["type"]))
	var pos := Vector2(float(p["x"]), float(p["y"]))
	var r := float(p["r"]) * float(p["scale"])
	var base := Color(String(def.get("color", "#8a8a8a")))
	var v := float(p["variant"])
	base = base.darkened(v * 0.18)
	var shape := DataLoader.str_of(def, "shape", "rock")
	draw_circle(pos + Vector2(0, r * 0.3), r * 1.0, Color(0, 0, 0, 0.22))
	# 有贴图就贴图（箱子/地雷/草丛这类），没有就按规定形状程序化画
	var tex := Sprites.prop_tex(String(p["type"]))
	if tex != null:
		Sprites.draw_centered(self, tex, pos, r * 2.6,
			Color(1, 1, 1, 1).darkened(v * 0.18))
		return
	match shape:
		"bush":
			draw_circle(pos, r, base)
			draw_circle(pos + Vector2(-r * 0.4, -r * 0.3), r * 0.6, base.lightened(0.15))
			draw_circle(pos + Vector2(r * 0.45, -r * 0.1), r * 0.5, base.lightened(0.08))
		"tree":
			draw_rect(Rect2(pos.x - r * 0.18, pos.y - r * 0.2, r * 0.36, r * 1.2), base.darkened(0.35))
			draw_circle(pos + Vector2(0, -r * 0.7), r, base)
		"crystal":
			draw_colored_polygon(PackedVector2Array([
				pos + Vector2(0, -r * 1.3), pos + Vector2(r * 0.7, r * 0.5),
				pos + Vector2(-r * 0.7, r * 0.5)]), base)
		"crate", "wreck", "scrap":
			draw_rect(Rect2(pos - Vector2(r * 0.9, r * 0.7), Vector2(r * 1.8, r * 1.4)), base)
			draw_rect(Rect2(pos - Vector2(r * 0.9, r * 0.7), Vector2(r * 1.8, r * 1.4)),
				base.darkened(0.4), false, 2.0)
		_:
			draw_circle(pos, r, base)
			draw_circle(pos, r * 0.6, base.lightened(0.2))
	if float(p.get("hitFlash", 0.0)) > 0.0:
		draw_circle(pos, r * 1.15, Color(1, 1, 1, float(p["hitFlash"]) * 0.35))
