## 相机 —— `src/core/camera.js` 的移植（手感回归第三刀）。
##
## Godot 侧原来是一行 `camera.position.lerp(target, delta * 8)`：
##   - **平滑公式不同**：JS 用的是指数收敛 `t = 1 - exp(-12·dt)`，
##     线性 `dt×8` 在低帧率下会明显「跟不上」，高帧率下又太黏；
##   - **完全没有震屏**：`bus_shake()` 是个空函数（当初留的占位），
##     于是「挨打 / Boss 冲撞 / 基地被砸」这些反馈在 Godot 版里一点都没有；
##   - 也没有世界边界钳制，玩家跑到地图边缘时镜头会滑出地图。
##
## 这个类把三件事一次补齐，并且**全是纯计算**（`follow`/`update` 只改自己的字段），
## 所以能上黄金对比：逐帧比对跟随位置、震屏衰减曲线、边界钳制。
class_name CameraRig

const FOLLOW_LERP := 12.0      # 与 JS 的 `followLerp = 12` 一致：越大越紧
const ZOOM_LERP := 6.0
const DEFAULT_SHAKE_TIME := 0.32

var x := 0.0
var y := 0.0
var zoom := 1.0
var target_zoom := 1.0
var view_w := 1280.0
var view_h := 720.0
var bounds := Vector2.ZERO      # 世界大小（像素）；ZERO 表示不钳制
var shake_time := 0.0
var shake_mag := 0.0
var shake_x := 0.0
var shake_y := 0.0
var free_look := false
var rng: Rng = null


func _init(p_view_w: float = 1280.0, p_view_h: float = 720.0, p_rng: Rng = null) -> void:
	view_w = p_view_w
	view_h = p_view_h
	rng = p_rng


## 跟随（指数收敛，与 JS `follow` 同式）
func follow(tx: float, ty: float, dt: float) -> void:
	if free_look:
		return
	var t := 1.0 - exp(-FOLLOW_LERP * dt)
	x = lerpf(x, tx, t)
	y = lerpf(y, ty, t)
	clamp_to_bounds()


## 直接对准（切场景/进副本用）
func snap_to(tx: float, ty: float) -> void:
	x = tx
	y = ty
	clamp_to_bounds()


## 震屏。**取更强的那一次**：小震动不该盖掉正在播的大震动（与 JS 的 `shake()` 同义）
func shake(mag: float, time: float = DEFAULT_SHAKE_TIME) -> void:
	if mag > shake_mag or shake_time <= 0.0:
		shake_mag = maxf(shake_mag, mag)
	shake_time = maxf(shake_time, time)


## 每帧推进：缩放缓动 + 震屏偏移
func update(dt: float) -> void:
	zoom = lerpf(zoom, target_zoom, 1.0 - exp(-ZOOM_LERP * dt))
	if shake_time > 0.0:
		shake_time -= dt
		var k := maxf(0.0, shake_time) * shake_mag
		if rng != null:
			shake_x = rng.range_f(-k, k)
			shake_y = rng.range_f(-k, k)
		else:
			shake_x = randf_range(-k, k)
			shake_y = randf_range(-k, k)
		if shake_time <= 0.0:
			shake_mag = 0.0
			shake_x = 0.0
			shake_y = 0.0
	else:
		shake_x = 0.0
		shake_y = 0.0


## 边界钳制：视野不越出世界
func clamp_to_bounds() -> void:
	if bounds.x <= 0.0 or bounds.y <= 0.0:
		return
	var hw := view_w / 2.0 / zoom
	var hh := view_h / 2.0 / zoom
	if bounds.x <= hw * 2.0:
		x = bounds.x / 2.0
	else:
		x = clampf(x, hw, bounds.x - hw)
	if bounds.y <= hh * 2.0:
		y = bounds.y / 2.0
	else:
		y = clampf(y, hh, bounds.y - hh)


## 屏幕上应该用的位置（含震屏偏移）
func render_pos() -> Vector2:
	return Vector2(x + shake_x, y + shake_y)


func is_shaking() -> bool:
	return shake_time > 0.0


## 视野矩形（给「刷怪点四档规则」之类的系统用）
func view_rect() -> Rect2:
	var w := view_w / zoom
	var h := view_h / zoom
	return Rect2(x - w / 2.0, y - h / 2.0, w, h)
