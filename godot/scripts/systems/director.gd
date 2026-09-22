## 波次导演 + 吸引阵列 —— `src/systems/director.js` 的移植。
##
## 搬过来的规则（都是玩家反馈打磨出来的）：
##   - **波次预算** = (10 + Σ巢穴威胁 × 7.5) × (0.45 + 吸引强度) × (1 + 星球×0.16)
##   - **刷怪点四档规则**：巢在屏幕里→巢口；巢够远→巢口；巢在屏幕边→沿方向推到屏幕外；
##     没有巢→屏幕外沿随机方向（就是「别让虫子凭空出现在基地周围」那条）
##   - **吸引阵列**：燃料按秒消耗（`fuelPerSec` × 倍率 × 供电折扣），每波额外扣 6；
##     燃料耗尽 → 停机 + 进入 `fuel` 追杀模式；补能重启只解除燃料型追杀
##   - **波次间隔**：巢穴越少间隔越长（清巢收益），上下限 `waveIntervalMin/Base`
class_name Director

const FUEL_PER_SEC := 0.16
const FUEL_PER_WAVE := 6.0
const FUEL_MAX := 100.0
const WAVE_WARN_SECONDS := 22.0
const WAVE_INTERVAL_BASE := 150.0
const WAVE_INTERVAL_MIN := 66.0
const ALARM_WAVE_GAP := 18.0

enum State { CALM, INCOMING, ACTIVE, HUNT }

var world: GdWorld
var stats: StatSet
var rng: Rng
var enemies: Node2D
var player: Node2D
var camera: Node2D

var state := State.CALM
var wave_number := 0
var timer := 30.0
var warned := false
var composition: Array = []
var contributors: Array = []
var total := 0
var remaining := 0
var hunt_mode := false
var hunt_reason := ""
var hunt_timer := 0.0

# 吸引阵列
var beacon_fuel := FUEL_MAX
var beacon_online := true
## JS 里吸引阵列从 **0 级**开始，半径 = 900 + level×300（level 0 → 900）
var beacon_level := 0
var beacon_intensity := 0.28
var beacon_radius := 900.0
## 吸引阵列的位置（默认跟着基地；存档要存它 —— 读档丢了会让「范围内的巢穴」全落空）
var beacon_x := 0.0
var beacon_y := 0.0

var waves_started := 0
var kills_at_wave_start := 0


func setup(p_world: GdWorld, p_stats: StatSet, p_enemies: Node2D, p_player: Node2D, p_camera: Node2D, p_rng: Rng) -> void:
	world = p_world
	stats = p_stats
	enemies = p_enemies
	player = p_player
	camera = p_camera
	rng = p_rng


func _bx() -> float:
	if beacon_x != 0.0 or beacon_y != 0.0:
		return beacon_x
	return float(world.base_site["x"]) if world != null and world.base_site != null else 0.0


func _by() -> float:
	if beacon_x != 0.0 or beacon_y != 0.0:
		return beacon_y
	return float(world.base_site["y"]) if world != null and world.base_site != null else 0.0


## 属性可能还没装配（读档早期/测试替身），这里要能容 null
func _stat(key: String) -> float:
	return stats.stat(key) if stats != null else 0.0


func beacon_radius_for(level: int) -> float:
	# 与 runState 的 beacon.refresh 同式：900 + level×300（再乘科技倍率）
	return (900.0 + float(level) * 300.0) * (1.0 + _stat("beaconRadiusMult"))


func beacon_intensity_for(level: int) -> float:
	return minf(1.45, (0.28 + float(level) * 0.14)
		* (1.0 + _stat("beaconIntensityMult") + _stat("beaconIntensity")))


func beacon_fuel_max_for(level: int) -> float:
	return FUEL_MAX + float(level) * 12.0


## 当前等级下的燃料上限（HUD 用；与 JS 的 `fuelMax = 100 + level*12` 同式）
func beacon_fuel_max() -> float:
	return beacon_fuel_max_for(beacon_level)


func update(dt: float) -> void:
	update_beacon(dt)


# =========================================================
#  吸引阵列
# =========================================================

func update_beacon(dt: float) -> void:
	if not beacon_online:
		return
	# 供电折扣：powerOutput 每点抵 6%，最多抵到 15% 耗能
	var power := stats.stat("powerOutput") * 0.06
	var use := FUEL_PER_SEC * (1.0 + stats.stat("beaconFuelMult")) * maxf(0.15, 1.0 - power)
	beacon_fuel -= use * dt
	var regen := stats.stat("beaconFuelRegen")
	if regen > 0.0:
		beacon_fuel = minf(FUEL_MAX, beacon_fuel + regen * dt)
	if beacon_fuel <= 0.0:
		beacon_fuel = 0.0
		beacon_online = false
		start_hunt("fuel")
		print("[godot] 吸引阵列停机：燃料耗尽 → 进入追杀模式")


func start_hunt(reason: String) -> void:
	if hunt_mode:
		return
	hunt_mode = true
	hunt_reason = reason
	hunt_timer = minf(hunt_timer if hunt_timer > 0.0 else ALARM_WAVE_GAP, ALARM_WAVE_GAP)
	state = State.HUNT


func stop_hunt(reason: String = "") -> void:
	if not hunt_mode:
		return
	if reason != "" and hunt_reason != reason:
		return
	hunt_mode = false
	hunt_reason = ""
	state = State.CALM


func refuel(amount: float) -> void:
	var was_offline := (not beacon_online) or beacon_fuel <= 0.0
	beacon_fuel = minf(FUEL_MAX, beacon_fuel + amount)
	if beacon_fuel > 0.0 and not beacon_online:
		beacon_online = true
	if was_offline:
		stop_hunt("fuel")


# =========================================================
#  怪潮
# =========================================================

func next_interval() -> float:
	var nests_alive := 0
	for n in world.nests:
		if not GdMath.truthy(n.get("destroyed", false)):
			nests_alive += 1
	var nest_factor := GdMath.clampf01(float(nests_alive) / maxf(1.0, float(world.nests.size())))
	return GdMath.clampv(WAVE_INTERVAL_BASE * (0.6 + nest_factor * 0.55),
		WAVE_INTERVAL_MIN, WAVE_INTERVAL_BASE * 1.4)


## 巢穴贡献者：范围内的全部 + 范围外按强度概率「部分牵引」
func contributors_for() -> Array:
	var alive: Array = []
	for n in world.nests:
		if not GdMath.truthy(n.get("destroyed", false)):
			alive.append(n)
	var in_range: Array = []
	var far_ones: Array = []
	for n in alive:
		if GdMath.dist(float(n["x"]), float(n["y"]), _bx(), _by()) <= beacon_radius:
			in_range.append(n)
		else:
			far_ones.append(n)
	var out: Array = in_range.duplicate()
	for n in far_ones:
		if rng.chance(0.22 * beacon_intensity):
			out.append(n)
	if out.is_empty() and not alive.is_empty():
		out.append(rng.pick(alive))
	return out


## 怪种池（与 JS buildPool 同序：基础/中级/高级/特殊 + 群系怪 + 高强度加权）
func build_pool(contribs: Array) -> Array:
	var pool: Array = []
	var max_tier := 1
	for n in contribs:
		max_tier = maxi(max_tier, int(n["tier"]))
	for t in _roster("base"):
		pool.append([t, 26])
	if max_tier >= 2:
		for t in _roster("mid"):
			pool.append([t, 22])
	if max_tier >= 3:
		for t in _roster("high"):
			pool.append([t, 20])
	if max_tier >= 4:
		for t in _roster("special"):
			pool.append([t, 8])
	for n in contribs:
		var biome := int(n.get("biome", 0))
		for t in _biome_monsters(biome):
			pool.append([t, 7])
	if beacon_intensity > 0.6:
		for t in _roster("special"):
			pool.append([t, 14])
		for t in _roster("high"):
			pool.append([t, 10])
	return pool


var _monster_def_table: Dictionary = {}

func _monster_defs() -> Dictionary:
	if _monster_def_table.is_empty():
		_monster_def_table = DataLoader.new().table("monsters", "MONSTER_DEF", {})
	return _monster_def_table


var _monsters_module: Dictionary = {}

func _monsters_module_data() -> Dictionary:
	if _monsters_module.is_empty():
		_monsters_module = DataLoader.new().module("monsters")
	return _monsters_module


## 怪种梯度表（monsters.js 的 NEST_ROSTER：base/mid/high/special）
func _roster(key: String) -> Array:
	var r = _monsters_module_data().get("NEST_ROSTER", {})
	if r is Dictionary:
		return r.get(key, [])
	return []


## 群系专属怪（monsters.js 的 BIOME_MONSTERS，按群系数值下标）
func _biome_monsters(biome: int) -> Array:
	var bm = _monsters_module_data().get("BIOME_MONSTERS", {})
	if bm is Dictionary:
		return bm.get(str(biome), [])
	return []


## 开始一波
func start_wave() -> Dictionary:
	if not beacon_online:
		state = State.CALM
		timer = 25.0
		return {}
	beacon_fuel = maxf(0.0, beacon_fuel - FUEL_PER_WAVE)
	wave_number += 1
	waves_started += 1
	state = State.INCOMING
	timer = WAVE_WARN_SECONDS
	warned = false

	var contribs := contributors_for()
	var threat := 0.0
	for n in contribs:
		threat += float(n["threat"])
	var budget := int(round((10.0 + threat * 7.5) * (0.45 + beacon_intensity)
		* (1.0 + float(world.planet_index) * 0.16)))

	composition = []
	var spent := 0
	var pool := build_pool(contribs)
	var defs := _monster_defs()
	var guard := 0
	while spent < budget and composition.size() < 90 and guard < 400:
		guard += 1
		var type = rng.weighted(pool)
		if type == null or not defs.has(String(type)):
			break
		var d: Dictionary = defs[String(type)]
		var cost := 1 + int(floor(DataLoader.num_or(d, "hp", 10.0) / 45.0)) + (6 if GdMath.truthy(d.get("elite", false)) else 0)
		var nest = rng.pick(contribs)
		if nest == null:
			break
		composition.append({ "type": String(type), "nest": String(nest["id"]) })
		spent += cost

	contributors = contribs
	total = composition.size()
	remaining = total
	return { "number": wave_number, "count": total, "contributors": contribs.size(), "budget": budget }


## 把一波怪撒到各贡献巢穴（刷怪点走 spawn_point 的四档规则）
func spawn_wave() -> int:
	var spawned := 0
	for item in composition:
		var nest = null
		for n in contributors:
			if String(n["id"]) == String(item["nest"]):
				nest = n
				break
		if nest == null and not contributors.is_empty():
			nest = contributors[0]
		if nest == null:
			continue
		var spot := spawn_point(nest)
		if enemies == null or enemies._types.is_empty():
			continue
		var defs := _monster_defs()
		var d: Dictionary = defs.get(String(item["type"]), {})
		if d.is_empty():
			continue
		var scale := EnemyFactory.scale_for(world.planet_index, int(nest["tier"]), 1.0)
		var e: Dictionary = enemies.spawn(d, float(spot["x"]), float(spot["y"]),
			{ "tier": int(nest["tier"]), "scale": scale, "fromNest": String(nest["id"]), "role": "wave" })
		if not e.is_empty():
			e["speed"] = float(e["speed"]) * 1.1     # 怪潮单位略快，保证能走到
			spawned += 1
	return spawned


## 刷怪点四档规则（玩家反馈「虫子别在基地周围凭空出现」之后定下来的）
func spawn_point(prefer, opts: Dictionary = {}) -> Dictionary:
	var view := _view_rect()
	var anchor: Vector2 = opts.get("anchor", _camera_pos())
	var margin := float(opts.get("margin", 90.0))
	var view_r := 700.0
	if view != Rect2():
		view_r = GdMath.dist(view.position.x, view.position.y, view.end.x, view.end.y) * 0.5
	var standoff := view_r + margin + float(opts.get("standoff", 180.0))
	var open_radius := float(opts.get("openRadius", 240.0))

	if prefer != null:
		var px := float(prefer["x"])
		var py := float(prefer["y"])
		var visible := view != Rect2() and px > view.position.x and px < view.end.x \
			and py > view.position.y and py < view.end.y
		if visible:
			return _nest_spot(prefer, open_radius)
		var d := GdMath.dist(px, py, anchor.x, anchor.y)
		if d >= standoff:
			return _nest_spot(prefer, open_radius)
		var ang := atan2(py - anchor.y, px - anchor.x)
		return world.find_open_spot(anchor.x + cos(ang) * standoff, anchor.y + sin(ang) * standoff, open_radius)
	var ang2 := rng.next_f() * TAU
	return world.find_open_spot(anchor.x + cos(ang2) * standoff, anchor.y + sin(ang2) * standoff, open_radius)


func _nest_spot(nest: Dictionary, open_radius: float) -> Dictionary:
	var a := rng.next_f() * TAU
	var r := rng.range_f(float(nest.get("r", 44.0)) * 1.5, float(nest.get("r", 44.0)) * 4.0)
	return world.find_open_spot(float(nest["x"]) + cos(a) * r, float(nest["y"]) + sin(a) * r, open_radius)


func _camera_pos() -> Vector2:
	if camera != null:
		return camera.position
	if player != null:
		return player.position
	return Vector2.ZERO


## 视野尺寸覆盖（只给测试用）。
##
## headless 下 `get_viewport_rect()` 给的是 1280×1280（没有真实窗口），
## 与游戏里 1280×720 的窗口不一致 —— 会让「屏幕外沿」的 standoff 算错、
## 黄金对比跟着红一片。测试里显式指定成 1280×720；真机保持 (0,0) 走真实 viewport。
var view_size_override := Vector2.ZERO


func _view_rect() -> Rect2:
	if camera == null:
		return Rect2()
	var size := view_size_override
	if size == Vector2.ZERO:
		size = Vector2(1280, 720)
		if camera is Camera2D:
			size = camera.get_viewport_rect().size / camera.zoom
	return Rect2(camera.position - size / 2.0, size)
