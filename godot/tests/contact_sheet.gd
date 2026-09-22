## 把素材包里的编号 PNG 拼成一张「接触表」（带编号），用来看清哪张是什么。
##
##   godot --headless --path godot --script res://tests/contact_sheet.gd -- --dir=... --from=1 --to=48 --out=...
##
## 为什么要它：Kenney 的包是 `towerDefense_tile001.png` 这种编号文件，
## 没有语义名。要接进游戏就得先把「编号 → 是什么」认出来，
## 一张带编号的接触表比逐张打开快得多（也留档，方便以后核对）。
extends SceneTree

const CELL := 96


func _initialize() -> void:
	# 工程外部的目录：用绝对路径（res:// 走不到 assets/，那在工程外）
	var dir_path := "D:/游戏2塔防/assets/_x_tower-defense-top-down/PNG/Default size"
	var from := 1
	var to := 48
	var out := "res://../tools/shots/contact-sheet.png"
	var cols := 8
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--dir="):
			dir_path = a.substr(6)
		elif a.begins_with("--from="):
			from = a.substr(7).to_int()
		elif a.begins_with("--to="):
			to = a.substr(5).to_int()
		elif a.begins_with("--out="):
			out = a.substr(6)
		elif a.begins_with("--cols="):
			cols = a.substr(7).to_int()
	_run(dir_path, from, to, out, cols)


func _run(dir_path: String, from: int, to: int, out: String, cols: int) -> void:
	var n := to - from + 1
	var rows := int(ceil(float(n) / float(cols)))
	var img := Image.create(cols * CELL, rows * CELL, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.08, 0.09, 0.12))
	var font := ThemeDB.fallback_font
	var placed := 0
	for i in range(from, to + 1):
		# 不同包的命名不一样：towerDefense_tileNNN / scifiUnit_NN / scifiStructure_NN
		var name := ""
		if dir_path.contains("scifiUnit"):
			name = "%s/scifiUnit_%02d.png" % [dir_path, i]
		elif dir_path.contains("scifiStructure"):
			name = "%s/scifiStructure_%02d.png" % [dir_path, i]
		elif dir_path.contains("scifiEnvironment"):
			name = "%s/scifiEnvironment_%02d.png" % [dir_path, i]
		else:
			name = "%s/towerDefense_tile%03d.png" % [dir_path, i]
		if not FileAccess.file_exists(name):
			continue
		# 工程外部的文件用 Image.load_from_file 直接读（load() 只认 res://）
		var img2 := Image.load_from_file(name)
		if img2 == null:
			continue
		var tex := ImageTexture.create_from_image(img2)
		if tex == null or not (tex is Texture2D):
			continue
		var src: Image = (tex as Texture2D).get_image()
		if src == null:
			continue
		src.convert(Image.FORMAT_RGBA8)
		var cx := (placed % cols) * CELL
		var cy := (placed / cols) * CELL
		# 缩放到格子内（保持正方形）
		var scaled := Image.create(CELL - 8, CELL - 8, false, Image.FORMAT_RGBA8)
		scaled.fill(Color(0, 0, 0, 0))
		src.resize(CELL - 8, CELL - 8, Image.INTERPOLATE_NEAREST)
		scaled.blend_rect(src, Rect2i(0, 0, CELL - 8, CELL - 8), Vector2i(4, 4))
		img.blend_rect(scaled, Rect2i(0, 0, CELL - 8, CELL - 8), Vector2i(cx, cy))
		# 编号（用引擎自带字体画在左上角）
		img.fill_rect(Rect2i(cx, cy, 30, 14), Color(0, 0, 0, 0.75))
		_draw_number(img, font, str(i), cx + 2, cy + 1)
		placed += 1
	img.save_png(ProjectSettings.globalize_path(out))
	print("CONTACT_SHEET " + out + " 张数 " + str(placed) + " 网格 " + str(cols) + "x" + str(rows))
	quit(0)


## 极简数字绘制：把 0-9 的 3×5 点阵画上去（不依赖字体渲染）
const GLYPHS := {
	"0": ["111", "101", "101", "101", "111"],
	"1": ["010", "110", "010", "010", "111"],
	"2": ["111", "001", "111", "100", "111"],
	"3": ["111", "001", "111", "001", "111"],
	"4": ["101", "101", "111", "001", "001"],
	"5": ["111", "100", "111", "001", "111"],
	"6": ["111", "100", "111", "101", "111"],
	"7": ["111", "001", "010", "010", "010"],
	"8": ["111", "101", "111", "101", "111"],
	"9": ["111", "101", "111", "001", "111"],
}


func _draw_number(img: Image, _font: Font, text: String, x: int, y: int) -> void:
	var col := Color(1, 1, 1)
	var cx := x
	for ch in text:
		var g: Array = GLYPHS.get(String(ch), [])
		for row in g.size():
			var line: String = g[row]
			for c in line.length():
				if line[c] == "1":
					for dy in 2:
						for dx in 2:
							img.set_pixel(cx + c * 2 + dx, y + row * 2 + dy, col)
		cx += 8
