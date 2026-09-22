## 移植版主场景（阶段 0：数据管线 + 里程碑门槛）。
##
## 现在只做三件事，但三件都能被自动化验证：
##   1. 读 `data/*.json`（证明数据管线在引擎里通了）
##   2. 用移植后的 Rng/ValueNoise 现场生成一小块地形预览
##      （证明世界生成的随机源已与 JS 版逐位一致）
##   3. 打印版本与统计，headless 下也能跑
extends Node2D

## 阶段 2 预览：世界生成的**地形**（不含障碍物/怪物）。
## 缩略图直接把 tiles 数组按地块颜色画出来 —— 一眼能看出岛形、
## 群系色块与巢穴焦土，也方便和 JS 版的截图对照。
const PREVIEW_TILES := 304
const TILE_PX := 2.0
const COLOR_TILES := 12               # 超过这个数量就抽稀（304/12 ≈ 每 25 格画一格）

var data: DataLoader
var world: GdWorld
var seed_text := "frontier-golden-a"
var tile_colors: PackedColorArray = PackedColorArray()
var _gen_ms := 0


func _ready() -> void:
	data = DataLoader.new()
	_build_tile_colors()
	print("[godot] 移植版启动 · Godot ", Engine.get_version_info().string)
	print("[godot] 数据：", data.summary().replace("\n", " | "))
	var t0 := Time.get_ticks_msec()
	world = GdWorld.new(seed_text, {})
	_gen_ms = Time.get_ticks_msec() - t0
	print("[godot] 世界生成 %d ms · 巢穴 %d · 地标 %d · 降落点 %d · tiles 哈希 %d" % [
		_gen_ms, world.nests.size(), world.pois.size(), world.landing_sites.size(), world.tiles_hash(),
	])
	# 缩略图画在以原点为左上角的 608×682 区域里；Camera2D 默认把 (0,0) 放在屏幕中心，
	# 所以要显式把相机对到这块区域的中心，否则只看得到右下角一格。
	var span := PREVIEW_TILES * TILE_PX * 4.0
	$Camera2D.position = Vector2(span / 2.0, span / 2.0 + 74.0)
	$UI/Info.text = _info_text()
	queue_redraw()


func _build_tile_colors() -> void:
	tile_colors.resize(19)
	var defs: Dictionary = data.table("tiles", "TILE_DEF", {})
	for i in 19:
		var d = defs.get(str(i), defs.get(i, null))
		var c := Color(0.02, 0.03, 0.05)
		if d is Dictionary and d.has("color"):
			c = Color(String(d["color"]))
		tile_colors[i] = c


func _info_text() -> String:
	return "\n".join([
		"开拓者：殖民地 —— Godot 移植版（阶段 2：世界生成已与 JS 逐位一致）",
		"种子 %s · 生成耗时 %d ms" % [seed_text, _gen_ms],
		"巢穴 %d · 地标 %d · 降落点 %d · tiles 哈希 %d" % [
			world.nests.size(), world.pois.size(), world.landing_sites.size(), world.tiles_hash()],
		"（红点 = 巢穴，蓝圈 = 降落点，灰框 = 主连通区边界；按 R 换种子，按 M 换看图方式）",
	])


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_R:
			seed_text = "frontier-%s" % str(Time.get_ticks_msec())
			_ready()
		elif event.keycode == KEY_M:
			tile_px_mode = not tile_px_mode
			queue_redraw()
		elif event.keycode == KEY_F:
			# 流场是阶段 3 的成果：按 F 现场算一次并画成箭头场
			# （第一次会卡一下 —— 实测耗时见 PORT-PLAN 的性能一节）
			if flow_field == null:
				var flow := world.ensure_flow()
				var t0 := Time.get_ticks_msec()
				flow.compute(int(world.base_site["tx"]), int(world.base_site["ty"]), world.tiles)
				_flow_ms = Time.get_ticks_msec() - t0
				flow_field = flow
				print("[godot] 流场计算 %d ms · maxCost %d" % [_flow_ms, int(flow.max_cost)])
				$UI/Info.text = _info_text()
			show_flow = not show_flow
			queue_redraw()


var tile_px_mode := false
var show_flow := false
var flow_field: FlowField = null
var _flow_ms := 0


func _draw() -> void:
	if world == null:
		return
	var step := 1 if tile_px_mode else 4          # 全分辨率 / 抽稀
	var px := TILE_PX if tile_px_mode else TILE_PX * 4.0
	for ty in range(0, PREVIEW_TILES, step):
		for tx in range(0, PREVIEW_TILES, step):
			var t: int = world.tiles[ty * PREVIEW_TILES + tx]
			var c := tile_colors[t] if t < tile_colors.size() else Color.BLACK
			c = c.darkened(float(world.variant[ty * PREVIEW_TILES + tx]) / 255.0 * 0.12)
			draw_rect(Rect2(tx * px, ty * px + 74, px, px), c)
	# 巢穴 / 降落点
	for nest in world.nests:
		var p := Vector2(float(nest["x"]) / float(Cfg.TILE) * px, float(nest["y"]) / float(Cfg.TILE) * px + 74)
		draw_circle(p, 3.0, Color(1, 0.25, 0.3))
	for site in world.landing_sites:
		var p := Vector2(float(site["x"]) / float(Cfg.TILE) * px, float(site["y"]) / float(Cfg.TILE) * px + 74)
		draw_arc(p, 8.0, 0, TAU, 20, Color(0.4, 0.85, 1.0), 2.0)
	if world.base_site != null:
		var p := Vector2(float(world.base_site["x"]) / float(Cfg.TILE) * px, float(world.base_site["y"]) / float(Cfg.TILE) * px + 74)
		draw_rect(Rect2(p - Vector2(6, 6), Vector2(12, 12)), Color(1, 0.85, 0.3), false, 2.0)
	# 流场箭头（按 F 切换）
	if show_flow and flow_field != null:
		var stride := 2
		for gy in range(0, flow_field.h, stride):
			for gx in range(0, flow_field.w, stride):
				var idx := gy * flow_field.w + gx
				if flow_field.stamp[idx] != flow_field.generation:
					continue
				var dx := flow_field.dir_x[idx]
				var dy := flow_field.dir_y[idx]
				if absf(dx) < 0.01 and absf(dy) < 0.01:
					continue
				var cx := (float(gx) + 0.5) * float(Cfg.TILE * flow_field.cell) / float(Cfg.TILE) * px
				var cy := (float(gy) + 0.5) * float(Cfg.TILE * flow_field.cell) / float(Cfg.TILE) * px + 74.0
				var base := Vector2(cx, cy)
				draw_line(base, base + Vector2(dx, dy) * 5.0, Color(0.5, 1.0, 0.7, 0.75), 1.0)

