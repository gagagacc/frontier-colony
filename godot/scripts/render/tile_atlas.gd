## 程序化地块图集 —— `src/render/renderer.js` 里 `drawTileDetail` 的移植。
##
## JS 版每格直接往 canvas 上画矢量细节（草叶、圆点、三角…）；
## Godot 里逐格画几千个图元太慢，所以改成：
##   **启动时把「每种地块 × 5 档明暗变化」烘成一张图集**，
##   运行时只按 (地块, 变化档) 取一小块贴图 —— 同一张图集还能被 Godot 合批。
##
## 明暗档来自 `world.variant`（JS 用的是 `shade(color, (v-0.5)*0.10)`，
## 连续变化 → 这里量化成 5 档，视觉上等价：±0.05 以内人眼分不出来）。
class_name TileAtlas

const TILE_PX := Cfg.TILE          # 40
const VARIANTS := 5                # 明暗档数
const COLS := 8                    # 图集列数

var texture: ImageTexture
var image: Image
var tile_ids: Array = []
var _region_cache: Dictionary = {}
var content_hash := 0


## 贴图优先、程序化兜底 —— 与 JS 版的 `assets/manifest.json` 同一套思路：
## 表里有就贴图，没有就画色块，所以可以一块一块换而不破坏游戏。
##
## 贴图放在 `res://assets/tiles/terrain_<名字>.png`（64×64 的 Kenney 素材）。
## 烘焙时缩放到 TILE_PX，并**保留 variant 明暗档**（每个地块 5 档）：
## 玩家反馈过「能用的素材就别用色块」，但明暗档是原版就有的地形层次感，不能丢。
const TILE_TEXTURES := {
	1: "res://assets/tiles/terrain_grass.png",     # 草地
	2: "res://assets/tiles/terrain_dirt.png",      # 泥土
	3: "res://assets/tiles/terrain_sand.png",      # 沙地
	4: "res://assets/tiles/terrain_stone.png",     # 岩石
	5: "res://assets/tiles/terrain_water.png",     # 水
	6: "res://assets/tiles/terrain_ash.png",       # 焦土
}


func build(tile_defs: Dictionary) -> void:
	tile_ids = []
	for i in 19:
		if tile_defs.has(str(i)) or tile_defs.has(i):
			tile_ids.append(i)
	var rows := int(ceil(float(tile_ids.size() * VARIANTS) / float(COLS)))
	image = Image.create(COLS * TILE_PX, maxi(1, rows) * TILE_PX, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))

	for ti in tile_ids.size():
		var tile_id: int = tile_ids[ti]
		var def = tile_defs.get(str(tile_id), tile_defs.get(tile_id, {}))
		var base := Color(String(def.get("color", "#888888")))
		var tex_img := _load_tile_texture(tile_id)
		for v in VARIANTS:
			var amount := (float(v) / float(VARIANTS - 1) - 0.5) * 0.10
			var cell := ti * VARIANTS + v
			var cx := (cell % COLS) * TILE_PX
			var cy := (cell / COLS) * TILE_PX
			if tex_img != null:
				_paint_tile_texture(cx, cy, tex_img, amount)
			else:
				_paint_tile(cx, cy, tile_id, base, amount, v)
	texture = ImageTexture.create_from_image(image)
	content_hash = _hash_image(image)


## 读一张地形贴图（缓存；没有就返回 null → 走程序化绘制）
var _tex_cache: Dictionary = {}


func _load_tile_texture(tile_id: int) -> Image:
	if not TILE_TEXTURES.has(tile_id):
		return null
	if _tex_cache.has(tile_id):
		return _tex_cache[tile_id]
	var path := String(TILE_TEXTURES[tile_id])
	var img: Image = null
	if ResourceLoader.exists(path):
		var tex := load(path)
		if tex is Texture2D:
			img = (tex as Texture2D).get_image()
	elif FileAccess.file_exists(path):
		img = Image.load_from_file(ProjectSettings.globalize_path(path))
	if img != null:
		img.convert(Image.FORMAT_RGBA8)
		img.resize(TILE_PX, TILE_PX, Image.INTERPOLATE_NEAREST)
	_tex_cache[tile_id] = img
	return img


## 把贴图贴进图集的一格，并按 variant 调明暗
func _paint_tile_texture(ox: int, oy: int, src: Image, amount: float) -> void:
	image.blend_rect(src, Rect2i(0, 0, TILE_PX, TILE_PX), Vector2i(ox, oy))
	if absf(amount) < 0.001:
		return
	# 明暗档：亮的用白叠、暗的用黑叠，透明度取 |amount|*3（否则几乎看不出来）
	var tint := Color(1, 1, 1, amount * 3.0) if amount > 0.0 else Color(0, 0, 0, -amount * 3.0)
	_fill_rect(ox, oy, TILE_PX, TILE_PX, tint)


## 一小块图集的区域（给 draw_texture_rect_region 用）
func region_for(tile_id: int, variant_byte: int) -> Rect2:
	var ti := tile_ids.find(tile_id)
	if ti < 0:
		ti = 0
	var bucket := int(floor(float(variant_byte) / 255.0 * float(VARIANTS)))
	bucket = clampi(bucket, 0, VARIANTS - 1)
	var key := ti * 16 + bucket
	if _region_cache.has(key):
		return _region_cache[key]
	var cell := ti * VARIANTS + bucket
	var r := Rect2(float((cell % COLS) * TILE_PX), float((cell / COLS) * TILE_PX), float(TILE_PX), float(TILE_PX))
	_region_cache[key] = r
	return r


# =========================================================
#  逐格绘制（都是「一个像素块」级别的操作，等价的 JS 版本见 renderer.js）
# =========================================================

func _paint_tile(ox: int, oy: int, tile_id: int, base: Color, amount: float, variant: int) -> void:
	var c := _shade(base, amount)
	_fill_rect(ox, oy, TILE_PX, TILE_PX, c)

	# 每格的细节用「地块 + 变化档」当种子，保证同一档永远长得一样
	var h := _hash01(tile_id * 31 + variant)
	match tile_id:
		Cfg.T_VOID:
			_fill_rect(ox, oy, TILE_PX, TILE_PX, Color("#04060c"))
		Cfg.T_NEST_FLOOR:
			# 横向肌肉纹理：副本里「哪能走」必须一眼看出来
			for i in 2:
				var gy := oy + 8 + i * 18 + int(_hash01(tile_id * 7 + i + variant) * 4.0)
				_line(ox, gy, ox + TILE_PX, gy + int((_hash01(tile_id * 13 + i + variant) - 0.5) * 4.0),
					Color(1.0, 0.47, 0.59, 0.06 + float(variant) * 0.01))
			if h > 0.72:
				_disc(ox + 10 + int(_hash01(8) * 20.0), oy + 12 + int(_hash01(9) * 16.0),
					6 + int(_hash01(10) * 5.0), Color(0.35, 0.08, 0.16, 0.35))
		Cfg.T_NEST_ORGAN:
			_ring(ox + TILE_PX / 2, oy + TILE_PX / 2, 6 + int(h * 6.0), Color(1.0, 0.31, 0.43, 0.18 + float(variant) * 0.03), 1)
			_fill_rect(ox + 3, oy + 3, TILE_PX - 6, TILE_PX - 6, Color(1.0, 0.24, 0.35, 0.10))
		Cfg.T_GRASS:
			for i in 3:
				var gx := ox + 4 + int(_hash01(tile_id * 17 + i) * float(TILE_PX - 8))
				var gy2 := oy + 6 + int(_hash01(tile_id * 19 + i) * float(TILE_PX - 12))
				_line(gx, gy2 + 4, gx + int((_hash01(tile_id * 23 + i) - 0.5) * 3.0), gy2 - 2,
					Color(0.59, 0.78, 0.47, 0.05 + float(variant) * 0.016))
		Cfg.T_SAND, Cfg.T_REGOLITH:
			_disc(ox + int(_hash01(1) * TILE_PX), oy + int(_hash01(2) * TILE_PX),
				1 + int(_hash01(3) * 1.6), Color(0, 0, 0, 0.03 + float(variant) * 0.008))
			_disc(ox + int(_hash01(4) * TILE_PX), oy + int(_hash01(6) * TILE_PX),
				1 + int(_hash01(7) * 1.2), Color(1, 1, 1, 0.035))
		Cfg.T_ROCK, Cfg.T_MOUNTAIN:
			var alpha := 0.06 if tile_id == Cfg.T_MOUNTAIN else 0.045
			_triangle(ox + 3, oy + TILE_PX - 4, ox + int(TILE_PX * 0.4), oy + 5 + int(h * 6.0),
				ox + TILE_PX - 4, oy + TILE_PX - 5, Color(1, 1, 1, alpha))
			_fill_rect(ox, oy + TILE_PX - 4, TILE_PX, 4, Color(0, 0, 0, 0.18))
		Cfg.T_WATER:
			_line(ox + 3, oy + 8 + variant, ox + TILE_PX - 3, oy + 8 + variant, Color(0.47, 0.86, 1.0, 0.04 + float(variant) * 0.01))
			_fill_rect(ox, oy, TILE_PX, 2, Color(0, 0, 0, 0.16))
		Cfg.T_CRYSTAL:
			_triangle(ox + 6, oy + TILE_PX - 7, ox + TILE_PX / 2, oy + 7, ox + TILE_PX - 6, oy + TILE_PX - 7,
				Color(0.78, 0.67, 1.0, 0.10))
		Cfg.T_SCORCHED:
			_disc(ox + int(_hash01(2) * TILE_PX), oy + int(_hash01(3) * TILE_PX),
				2 + int(_hash01(4) * 3.0), Color(1.0, 0.35, 0.16, 0.05 + float(variant) * 0.012))
		Cfg.T_SWAMP:
			_disc(ox + int(_hash01(1) * TILE_PX), oy + int(_hash01(2) * TILE_PX),
				3 + int(_hash01(3) * 4.0), Color(0.55, 0.86, 0.47, 0.06 + float(variant) * 0.012))
		Cfg.T_ICE:
			_line(ox, oy + int(_hash01(1) * TILE_PX), ox + TILE_PX, oy + int(_hash01(2) * TILE_PX),
				Color(0.86, 0.96, 1.0, 0.10 + float(variant) * 0.016))
		Cfg.T_CONCRETE:
			_rect_outline(ox, oy, TILE_PX, TILE_PX, Color(0, 0, 0, 0.14))
			_fill_rect(ox + 2, oy + 2, TILE_PX - 4, 2, Color(1, 1, 1, 0.03))
		Cfg.T_ROAD:
			_fill_rect(ox + 4, oy + TILE_PX / 2 - 1, TILE_PX - 8, 2, Color(1, 0.86, 0.55, 0.10))
		Cfg.T_FUNGUS:
			_disc(ox + int(_hash01(1) * TILE_PX), oy + int(_hash01(2) * TILE_PX),
				2 + int(_hash01(3) * 2.0), Color(0.86, 0.55, 0.94, 0.10 + float(variant) * 0.02))
		Cfg.T_ASH:
			_fill_rect(ox + int(_hash01(1) * TILE_PX), oy + int(_hash01(2) * TILE_PX), 2, 2,
				Color(1.0, 0.55, 0.31, 0.03 + float(variant) * 0.008))
		_:
			pass


## 与 JS `shade(hex, amount)` 同义
static func _shade(c: Color, amount: float) -> Color:
	if amount > 0.0:
		return Color(
			c.r + (1.0 - c.r) * amount,
			c.g + (1.0 - c.g) * amount,
			c.b + (1.0 - c.b) * amount, c.a)
	var k := 1.0 + amount
	return Color(c.r * k, c.g * k, c.b * k, c.a)


# ---- 像素级图元 ----

func _fill_rect(x: int, y: int, w: int, h: int, c: Color) -> void:
	for yy in range(maxi(0, y), mini(image.get_height(), y + h)):
		for xx in range(maxi(0, x), mini(image.get_width(), x + w)):
			_blend(xx, yy, c)


func _rect_outline(x: int, y: int, w: int, h: int, c: Color) -> void:
	_fill_rect(x, y, w, 1, c)
	_fill_rect(x, y + h - 1, w, 1, c)
	_fill_rect(x, y, 1, h, c)
	_fill_rect(x + w - 1, y, 1, h, c)


func _line(x0: int, y0: int, x1: int, y1: int, c: Color) -> void:
	var dx := absi(x1 - x0)
	var dy := -absi(y1 - y0)
	var sx := 1 if x0 < x1 else -1
	var sy := 1 if y0 < y1 else -1
	var err := dx + dy
	var x := x0
	var y := y0
	var guard := 0
	while guard < 4096:
		guard += 1
		_blend(x, y, c)
		if x == x1 and y == y1:
			break
		var e2 := err * 2
		if e2 >= dy:
			err += dy
			x += sx
		if e2 <= dx:
			err += dx
			y += sy


func _disc(cx: int, cy: int, r: int, c: Color) -> void:
	for yy in range(cy - r, cy + r + 1):
		for xx in range(cx - r, cx + r + 1):
			var dx := xx - cx
			var dy := yy - cy
			if dx * dx + dy * dy <= r * r:
				_blend(xx, yy, c)


func _ring(cx: int, cy: int, r: int, c: Color, thickness: int) -> void:
	for yy in range(cy - r - 1, cy + r + 2):
		for xx in range(cx - r - 1, cx + r + 2):
			var dx := xx - cx
			var dy := yy - cy
			var d2 := dx * dx + dy * dy
			if d2 <= r * r and d2 >= (r - thickness) * (r - thickness):
				_blend(xx, yy, c)


func _triangle(x0: int, y0: int, x1: int, y1: int, x2: int, y2: int, c: Color) -> void:
	var min_x := mini(x0, mini(x1, x2))
	var max_x := maxi(x0, maxi(x1, x2))
	var min_y := mini(y0, mini(y1, y2))
	var max_y := maxi(y0, maxi(y1, y2))
	for yy in range(min_y, max_y + 1):
		for xx in range(min_x, max_x + 1):
			if _in_tri(xx, yy, x0, y0, x1, y1, x2, y2):
				_blend(xx, yy, c)


func _in_tri(px: int, py: int, x0: int, y0: int, x1: int, y1: int, x2: int, y2: int) -> bool:
	var d1 := (px - x1) * (y0 - y1) - (x0 - x1) * (py - y1)
	var d2 := (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
	var d3 := (px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)
	var has_neg := d1 < 0 or d2 < 0 or d3 < 0
	var has_pos := d1 > 0 or d2 > 0 or d3 > 0
	return not (has_neg and has_pos)


func _blend(x: int, y: int, c: Color) -> void:
	if x < 0 or y < 0 or x >= image.get_width() or y >= image.get_height():
		return
	if c.a >= 0.999:
		image.set_pixel(x, y, c)
		return
	var dst := image.get_pixel(x, y)
	var a := c.a + dst.a * (1.0 - c.a)
	if a <= 0.0:
		image.set_pixel(x, y, Color(0, 0, 0, 0))
		return
	var out := Color(
		(c.r * c.a + dst.r * dst.a * (1.0 - c.a)) / a,
		(c.g * c.a + dst.g * dst.a * (1.0 - c.a)) / a,
		(c.b * c.a + dst.b * dst.a * (1.0 - c.a)) / a,
		a)
	image.set_pixel(x, y, out)


## 与 JS renderer 里那个 `h(n)` 同构的确定性哈希（这里按类型+档位取）
static func _hash01(n: int) -> float:
	var s := sin(float(n) * 127.1 + 311.7) * 43758.5453
	return s - floor(s)


func _hash_image(img: Image) -> int:
	var h := 2166136261
	var w := img.get_width()
	var hgt := img.get_height()
	for y in hgt:
		for x in w:
			var c := img.get_pixel(x, y)
			h = GdMath.imul(h ^ int(c.r8), 16777619)
			h = GdMath.imul(h ^ int(c.g8), 16777619)
			h = GdMath.imul(h ^ int(c.b8), 16777619)
	return h & GdMath.U32
