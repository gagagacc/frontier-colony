## 贴图加载器 —— 逻辑名 → `res://assets/...`，带缓存，**找不到就返回 null**。
##
## 与 JS 版 `assets/manifest.json` 同一套思路：贴图是可选的，
## 有就贴图、没有就退回程序化绘制 —— 这样才能一块一块换而不破坏游戏。
##
## 命名约定（文件都在 `godot/assets/` 下）：
##   sprites/tower_light.png      轻型炮塔
##   sprites/tower_heavy.png      重型炮塔
##   sprites/enemy_1..8.png       怪物（来自科技感 RTS 包的单位）
##   sprites/structure_1..6.png   建筑
##   sprites/bullet|rocket|flame.png  弹丸
##   sprites/prop_*.png           道具（箱子/地雷/草丛）
class_name Sprites

static var _cache: Dictionary = {}


## 按逻辑名取贴图；不存在返回 null
static func get_tex(name: String) -> Texture2D:
	if _cache.has(name):
		return _cache[name]
	for dir in ["sprites", "tiles", "ui"]:
		var path := "res://assets/%s/%s.png" % [dir, name]
		if ResourceLoader.exists(path):
			var tex := load(path)
			if tex is Texture2D:
				_cache[name] = tex
				return tex
	_cache[name] = null
	return null


## 塔的贴图（按 id 映射到我们拷贝进来的两张）
static func tower_tex(id: String) -> Texture2D:
	var heavy := ["mortar", "railgun", "tesla", "cryo", "flame", "sniper", "press", "forcefield"]
	var name := "tower_heavy" if heavy.has(id) else "tower_light"
	return get_tex(name)


## 怪物的贴图：8 张单位图按种类轮换（同一种怪始终同一张，看起来才像"一个物种"）
static func enemy_tex(kind: String) -> Texture2D:
	var idx := int(abs(kind.hash()) % 8) + 1
	return get_tex("enemy_%d" % idx)


## 道具贴图：按道具 key 的前缀归类
static func prop_tex(key: String) -> Texture2D:
	var k := key.to_lower()
	if k.contains("crate") or k.contains("supply") or k.contains("wreck"):
		return get_tex("prop_crate_green" if k.hash() % 2 == 0 else "prop_crate_wood")
	if k.contains("mine") or k.contains("spike"):
		return get_tex("prop_mine")
	if k.contains("tuft") or k.contains("grass") or k.contains("bush"):
		return get_tex("prop_grass_tuft")
	return null


## 建筑贴图
static func structure_tex(idx: int) -> Texture2D:
	return get_tex("structure_%d" % (clampi(idx, 1, 6)))


## 画一张居中的贴图（自动缩放到目标尺寸）
static func draw_centered(c: CanvasItem, tex: Texture2D, center: Vector2, size_px: float,
	tint: Color = Color.WHITE) -> void:
	if tex == null:
		return
	var s := tex.get_size()
	var k := size_px / maxf(s.x, s.y)
	var draw_size := s * k
	c.draw_texture_rect(tex, Rect2(center - draw_size / 2.0, draw_size), false, tint)
