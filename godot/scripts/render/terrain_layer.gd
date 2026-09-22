## 地形层 —— `renderer.drawTerrain` / `renderChunk` / `drawSolidEdge` 的移植。
##
## JS 版是「每个区块烘一张 canvas，再整张贴上去」；Godot 这边不需要那么做：
## 所有地块都来自**同一张图集**，Godot 会把同材质的 draw_texture_rect_region
## 合批成极少的 draw call，直接逐格画反而更快、也不需要维护区块缓存
##（也就不会再踩「缓存键没带世界 id」那个坑）。
##
## 「看得见的崖边」照搬 JS 的规则：实心地块只要挨着可通行地块，
## 就在交界处画一条亮边 —— 玩家反馈过「同样的材质看着能走，撞上去却是空气墙」。
extends Node2D

const TILE_PX := Cfg.TILE
const EDGE_COLOR := Color(1.0, 0.925, 0.745, 0.34)

var world: GdWorld
var atlas: TileAtlas
var camera: Camera2D
var show_flow := false
var flow: FlowField

## 统计（用来观察合批效果与可见格数）
var visible_tiles := 0
var drawn_edges := 0


func setup(p_world: GdWorld, p_atlas: TileAtlas, p_camera: Camera2D) -> void:
	world = p_world
	atlas = p_atlas
	camera = p_camera
	queue_redraw()


## 每帧重画。
##
## CanvasItem 的 `_draw` 只在被要求时执行 —— 相机跟随移动、或者换了一整个
## World（进副本）时都必须重画。以前只在 setup 时画一次，结果是：
## 进副本后画面停在**清屏色**上（玩家传送到了地图另一处，旧画面在视野外，
## 而新画面从来没画过）。地表上因为开局画过一次、视角没离开那块区域，
## 所以一直没暴露。
func _process(_dt: float) -> void:
	queue_redraw()


func _draw() -> void:
	if world == null or atlas == null or atlas.texture == null:
		return
	var view := _view_rect()
	var tx0 := maxi(0, int(floor(view.position.x / TILE_PX)) - 1)
	var ty0 := maxi(0, int(floor(view.position.y / TILE_PX)) - 1)
	var tx1 := mini(Cfg.WORLD_TILES - 1, int(ceil(view.end.x / TILE_PX)) + 1)
	var ty1 := mini(Cfg.WORLD_TILES - 1, int(ceil(view.end.y / TILE_PX)) + 1)

	visible_tiles = 0
	drawn_edges = 0
	for ty in range(ty0, ty1 + 1):
		for tx in range(tx0, tx1 + 1):
			var idx := ty * Cfg.WORLD_TILES + tx
			var tile: int = world.tiles[idx]
			var region := atlas.region_for(tile, world.variant[idx])
			draw_texture_rect_region(atlas.texture,
				Rect2(float(tx * TILE_PX), float(ty * TILE_PX), float(TILE_PX), float(TILE_PX)),
				region)
			visible_tiles += 1
			# 实心地块的崖边
			if Cfg.is_solid_tile(tile):
				_draw_solid_edges(tx, ty)
	# 巢壁沿通道描边（副本里靠它分辨「哪里能走」）
	for ty in range(ty0, ty1 + 1):
		for tx in range(tx0, tx1 + 1):
			if world.tiles[ty * Cfg.WORLD_TILES + tx] == Cfg.T_NEST_WALL:
				_draw_nest_edges(tx, ty)
	# 流场箭头（按 F 切换）
	if show_flow and flow != null:
		_draw_flow()


func _draw_flow() -> void:
	var step := 6
	var t := float(TILE_PX * flow.cell)
	for gy in range(0, flow.h, step):
		for gx in range(0, flow.w, step):
			var idx := gy * flow.w + gx
			if flow.stamp[idx] != flow.generation:
				continue
			var dx := flow.dir_x[idx]
			var dy := flow.dir_y[idx]
			if absf(dx) < 0.01 and absf(dy) < 0.01:
				continue
			var base := Vector2((float(gx) + 0.5) * t, (float(gy) + 0.5) * t)
			draw_line(base, base + Vector2(dx, dy) * 22.0, Color(0.5, 1.0, 0.7, 0.5), 2.0)


func _view_rect() -> Rect2:
	if camera == null:
		return Rect2(0, 0, 1280, 720)
	var size := get_viewport_rect().size / camera.zoom
	var center := camera.global_position
	return Rect2(center - size / 2.0, size)


func _walkable_at(tx: int, ty: int) -> bool:
	if tx < 0 or ty < 0 or tx >= Cfg.WORLD_TILES or ty >= Cfg.WORLD_TILES:
		return false
	return not Cfg.is_solid_tile(world.tiles[ty * Cfg.WORLD_TILES + tx])


func _draw_solid_edges(tx: int, ty: int) -> void:
	var px := float(tx * TILE_PX)
	var py := float(ty * TILE_PX)
	var t := float(TILE_PX)
	if _walkable_at(tx, ty + 1):
		draw_line(Vector2(px, py + t), Vector2(px + t, py + t), EDGE_COLOR, 2.0)
	if _walkable_at(tx, ty - 1):
		draw_line(Vector2(px, py), Vector2(px + t, py), EDGE_COLOR, 2.0)
	if _walkable_at(tx + 1, ty):
		draw_line(Vector2(px + t, py), Vector2(px + t, py + t), EDGE_COLOR, 2.0)
	if _walkable_at(tx - 1, ty):
		draw_line(Vector2(px, py), Vector2(px, py + t), EDGE_COLOR, 2.0)
	drawn_edges += 1


func _nest_open_at(tx: int, ty: int) -> bool:
	if tx < 0 or ty < 0 or tx >= Cfg.WORLD_TILES or ty >= Cfg.WORLD_TILES:
		return false
	var t: int = world.tiles[ty * Cfg.WORLD_TILES + tx]
	return t == Cfg.T_NEST_FLOOR or t == Cfg.T_NEST_ORGAN


func _draw_nest_edges(tx: int, ty: int) -> void:
	var px := float(tx * TILE_PX)
	var py := float(ty * TILE_PX)
	var t := float(TILE_PX)
	var c := Color(1.0, 0.275, 0.392, 0.20)
	if _nest_open_at(tx, ty + 1):
		draw_line(Vector2(px, py + t), Vector2(px + t, py + t), c, 2.0)
	if _nest_open_at(tx, ty - 1):
		draw_line(Vector2(px, py), Vector2(px + t, py), c, 2.0)
	if _nest_open_at(tx + 1, ty):
		draw_line(Vector2(px + t, py), Vector2(px + t, py + t), c, 2.0)
	if _nest_open_at(tx - 1, ty):
		draw_line(Vector2(px, py), Vector2(px, py + t), c, 2.0)


## 崖边签名：给黄金对比用（把「哪几面该描边」编码成一个整数哈希）
func solid_edge_signature() -> int:
	var h := 2166136261
	for ty in Cfg.WORLD_TILES:
		for tx in Cfg.WORLD_TILES:
			var idx := ty * Cfg.WORLD_TILES + tx
			if not Cfg.is_solid_tile(world.tiles[idx]):
				continue
			var mask := 0
			if _walkable_at(tx, ty + 1):
				mask |= 1
			if _walkable_at(tx, ty - 1):
				mask |= 2
			if _walkable_at(tx + 1, ty):
				mask |= 4
			if _walkable_at(tx - 1, ty):
				mask |= 8
			if mask != 0:
				h = GdMath.imul(h ^ (idx * 16 + mask), 16777619)
	return h & GdMath.U32
