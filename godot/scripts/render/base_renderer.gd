## 基地（核心舱）的绘制 —— 对应 JS `renderer.js` 的 drawBases。
##
## 之前 Godot 侧**完全没画基地**：世界生成会把 baseSite 放好、塔的建造范围也以它为中心，
## 但屏幕上什么都看不到 —— 玩家的原话就是「我的基地呢」。
##
## 照原版画这些层次（从下到上）：
##   1. 建造范围虚线圈（被毁时变红）；2. 光晕；3. 平台；4. 核心舱本体 + 天线 + 闪灯；
##   5. 「核心舱」标签；6. 耐久条；7. 被毁时画废墟 + **重建进度环**（0→100%）。
class_name BaseRenderer

const CORE_FILL := Color("#3d5a78")
const CORE_EDGE := Color("#8fe0ff")
const PLATFORM := Color("#2a3446")
const PLATFORM_EDGE := Color("#5d7fa0")
const GLOW := Color(0.35, 0.78, 1.0)


## 画一个基地。`time` 用来做呼吸/闪烁动画。
static func draw_base(c: CanvasItem, b: Dictionary, time: float,
	build_radius: float, under_attack: bool) -> void:
	var pos := Vector2(float(b["x"]), float(b["y"]))
	var r := float(b.get("r", 96.0))
	var destroyed := GdMath.truthy(b.get("destroyed", false))

	# ① 建造范围：虚线圆（Godot 没有 setLineDash，用短线段拼）
	_dashed_circle(c, pos, build_radius,
		Color(1.0, 0.31, 0.31, 0.18) if destroyed else Color(0.47, 0.82, 1.0, 0.14), 2.0)

	if destroyed:
		_draw_rubble(c, pos, r * 0.9)
		# 重建进度环：0→100%，让「按住 E 到底有没有用」看得见
		var pct := GdMath.clampf01(float(b.get("repairProgress", 0.0)))
		if pct > 0.001:
			c.draw_arc(pos, r * 1.15, 0, TAU, 48, Color(0, 0, 0, 0.45), 8.0)
			c.draw_arc(pos, r * 1.15, -PI / 2.0, -PI / 2.0 + TAU * pct, 48, Color("#6ee7a8"), 6.0)
			c.draw_string(ThemeDB.fallback_font, pos + Vector2(-44, -r * 1.15 - 12),
				"重建 %d%%" % int(round(pct * 100.0)), HORIZONTAL_ALIGNMENT_LEFT, -1, 15,
				Color("#d8f5e6"))
		else:
			c.draw_string(ThemeDB.fallback_font, pos + Vector2(-70, -r * 1.15 - 12),
				"按住 E 重建核心舱", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(1.0, 0.7, 0.7))
		return

	# ② 光晕（用同心圆近似径向渐变）
	var glow_steps := 6
	for i in range(glow_steps, 0, -1):
		var k := float(i) / float(glow_steps)
		c.draw_circle(pos, r * 1.8 * k, Color(GLOW.r, GLOW.g, GLOW.b, 0.035))

	# ③ 平台（呼吸）
	var pulse := 1.0 + sin(time * 2.0) * 0.02
	c.draw_circle(pos, r * 0.85 * pulse, PLATFORM)
	c.draw_arc(pos, r * 0.85 * pulse, 0, TAU, 48, PLATFORM_EDGE, 3.0)

	# ④ 核心舱本体：圆角方块 + 天线 + 闪灯
	var half := r * 0.45
	c.draw_rect(Rect2(pos - Vector2(half, half), Vector2(half * 2.0, half * 2.0)),
		CORE_FILL)
	c.draw_rect(Rect2(pos - Vector2(half, half), Vector2(half * 2.0, half * 2.0)),
		Color("#ff5f6d") if under_attack else CORE_EDGE, false, 3.0)
	c.draw_line(pos + Vector2(0, -half), pos + Vector2(0, -r * 1.1), CORE_EDGE, 2.5)
	var blink := (sin(time * 4.0) + 1.0) / 2.0
	c.draw_circle(pos + Vector2(0, -r * 1.1), 4.5,
		Color(1.0, 0.47, 0.31, 0.4 + blink * 0.6))
	# 舱门与标识
	c.draw_string(ThemeDB.fallback_font, pos + Vector2(-24, r * 0.72),
		"核心舱", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, CORE_EDGE)

	# ⑤ 耐久条（带护盾段）
	var frac := GdMath.clampf01(float(b.get("hp", 1.0)) / maxf(1.0, float(b.get("maxHp", 1.0))))
	var bar := Vector2(110.0, 8.0)
	var bar_pos := pos + Vector2(-bar.x / 2.0, -r - 22.0)
	c.draw_rect(Rect2(bar_pos, bar), Color(0, 0, 0, 0.55))
	c.draw_rect(Rect2(bar_pos + Vector2(1, 1), Vector2((bar.x - 2.0) * frac, bar.y - 2.0)),
		Color("#59d8ff") if frac > 0.35 else Color("#ff5f6d"))
	var shield := float(b.get("shield", 0.0))
	if shield > 0.0:
		var sf := GdMath.clampf01(shield / maxf(1.0, float(b.get("maxShield", 1.0))))
		c.draw_rect(Rect2(bar_pos - Vector2(0, 4), Vector2(bar.x * sf, 3)), Color("#c08cff"))
	c.draw_string(ThemeDB.fallback_font, bar_pos + Vector2(0, -4),
		String(b.get("name", "殖民地核心舱")), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#c9d4e0"))


## Godot 没有虚线段，用「每隔一段画一小节圆弧」近似
static func _dashed_circle(c: CanvasItem, center: Vector2, radius: float, col: Color,
	width: float) -> void:
	if radius <= 1.0:
		return
	var seg := 40
	var step := TAU / float(seg)
	for i in seg:
		if i % 2 == 1:
			continue
		var a0 := float(i) * step
		c.draw_arc(center, radius, a0, a0 + step * 0.7, 4, col, width)


static func _draw_rubble(c: CanvasItem, pos: Vector2, r: float) -> void:
	c.draw_circle(pos, r, Color("#241f1e"))
	c.draw_circle(pos + Vector2(-r * 0.3, r * 0.2), r * 0.4, Color("#3a3330"))
	c.draw_circle(pos + Vector2(r * 0.35, -r * 0.15), r * 0.32, Color("#3a3330"))
	c.draw_circle(pos + Vector2(r * 0.1, r * 0.4), r * 0.26, Color("#2e2a28"))
	# 冒烟
	for i in 3:
		var t := fmod(Time.get_ticks_msec() / 1000.0 + float(i) * 0.7, 2.0)
		c.draw_circle(pos + Vector2(sin(t * 3.0 + float(i)) * 10.0, -20.0 - t * 26.0),
			4.0 + t * 4.0, Color(0.6, 0.6, 0.6, 0.28 * (1.0 - t / 2.0)))
