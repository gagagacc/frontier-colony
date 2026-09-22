## 小地图 —— `src/ui/hud.js` 的 `buildMinimapBase` / `drawMinimap` 的移植。
##
## JS 版把整张世界烘成一张底图（ImageData），再叠实时标记；
## 这里用同样的做法：烘焙一次 `ImageTexture`，之后只画标记。
##
## 注意 JS 版踩过的坑：底图缓存必须记住「是哪张世界」（world.uid），
## 否则进副本（另一张世界、同样坐标）会继续画地表的底图。
extends Control

const SIZE := 168

var world: GdWorld
var atlas: TileAtlas
var base_texture: ImageTexture
var base_world_id := -1
var base_rev := -1
var player: Node2D
var nests: Array = []
var landing: Array = []


func setup(p_world: GdWorld, p_atlas: TileAtlas, p_player: Node2D) -> void:
	world = p_world
	atlas = p_atlas
	player = p_player
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = Vector2(SIZE, SIZE)
	_rebuild_base()


func _rebuild_base() -> void:
	if world == null:
		return
	var img := Image.create(Cfg.WORLD_TILES, Cfg.WORLD_TILES, false, Image.FORMAT_RGBA8)
	var defs: Dictionary = DataLoader.new().table("tiles", "TILE_DEF", {})
	for ty in Cfg.WORLD_TILES:
		for tx in Cfg.WORLD_TILES:
			var t: int = world.tiles[ty * Cfg.WORLD_TILES + tx]
			var d = defs.get(str(t), defs.get(t, null))
			var c := Color(0.02, 0.03, 0.05)
			if d is Dictionary and d.has("color"):
				c = Color(String(d["color"]))
			# 微变化，避免小地图是一整块纯色
			var v := float(world.variant[ty * Cfg.WORLD_TILES + tx]) / 255.0
			c = c.darkened(v * 0.12)
			img.set_pixel(tx, ty, c)
	base_texture = ImageTexture.create_from_image(img)
	base_world_id = world.uid
	base_rev = world.tile_revision


func _process(_delta: float) -> void:
	if world == null:
		return
	if base_texture == null or base_world_id != world.uid or base_rev != world.tile_revision:
		_rebuild_base()
	queue_redraw()


func _draw() -> void:
	if base_texture == null or world == null or player == null:
		return
	draw_rect(Rect2(Vector2.ZERO, Vector2(SIZE, SIZE)), Color(0.02, 0.03, 0.05, 0.9))
	draw_texture_rect(base_texture, Rect2(Vector2.ZERO, Vector2(SIZE, SIZE)), false)
	# 巢穴（红点）
	for nest in world.nests:
		if nest.get("destroyed", false):
			continue
		var p := Vector2(float(nest["x"]) / float(Cfg.WORLD_PX) * SIZE, float(nest["y"]) / float(Cfg.WORLD_PX) * SIZE)
		draw_circle(p, 2.0 + float(nest["tier"]) * 0.25, Color("#ff5f6d"))
	# 降落点（青圈）
	for site in world.landing_sites:
		var p := Vector2(float(site["x"]) / float(Cfg.WORLD_PX) * SIZE, float(site["y"]) / float(Cfg.WORLD_PX) * SIZE)
		draw_arc(p, 4.0, 0, TAU, 16, Color("#8fe0ff"), 1.0)
	# 玩家（白点 + 视野框）
	var pp := Vector2(player.position.x / float(Cfg.WORLD_PX) * SIZE, player.position.y / float(Cfg.WORLD_PX) * SIZE)
	draw_circle(pp, 2.5, Color.WHITE)
	draw_rect(Rect2(pp - Vector2(6, 4), Vector2(12, 8)), Color(1, 1, 1, 0.35), false, 1.0)
