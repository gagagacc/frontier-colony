## 界面主题 —— 中文像素字体 + 科幻面板皮（素材来自 Kenney 的 UI Pack: Sci-Fi）。
##
## 为什么要在代码里建主题：
##   1. **中文字体**：Kenney 的字体只有拉丁字形，不换字体中文会退化成方块或系统字体；
##      换成 Cubic 11（OFL-1.1）后界面才像"这个游戏"的。
##   2. **面板皮**：原来面板是纯色矩形，用 UI 包的 9-slice 之后才有科幻感
##      （9-slice 的好处：一张小图能拉伸成任意尺寸而不变形）。
##
## 贴图缺失时全部退回原来的样子，不会因为少一张图就跑不起来。
class_name UiTheme


static func build() -> Theme:
	var th := Theme.new()
	# ① 中文像素字体（找不到就保持引擎默认）
	var font_path := "res://assets/fonts/Cubic_11.ttf"
	if ResourceLoader.exists(font_path):
		var f := load(font_path)
		if f is Font:
			th.default_font = f
			th.default_font_size = 16
	# ② 面板皮：9-slice
	var panel_tex := _tex("res://assets/ui/panel_bg.png")
	if panel_tex != null:
		var sb := StyleBoxTexture.new()
		sb.texture = panel_tex
		sb.set_texture_margin_all(10.0)
		sb.content_margin_left = 14.0
		sb.content_margin_right = 14.0
		sb.content_margin_top = 12.0
		sb.content_margin_bottom = 12.0
		th.set_stylebox("panel", "PanelContainer", sb)
		th.set_stylebox("panel", "Panel", sb)
		th.set_stylebox("panel", "PopupPanel", sb)
	# ③ 按钮皮：normal / hover / pressed 三态
	var btn_tex := _tex("res://assets/ui/button_bg.png")
	if btn_tex != null:
		for state in ["normal", "hover", "pressed", "disabled", "focus"]:
			var sb := StyleBoxTexture.new()
			sb.texture = btn_tex
			sb.set_texture_margin_all(8.0)
			sb.content_margin_left = 12.0
			sb.content_margin_right = 12.0
			sb.content_margin_top = 8.0
			sb.content_margin_bottom = 8.0
			if state == "hover":
				sb.modulate_color = Color(1.15, 1.18, 1.25)
			elif state == "pressed":
				sb.modulate_color = Color(0.85, 0.92, 1.0)
			elif state == "disabled":
				sb.modulate_color = Color(0.6, 0.62, 0.68, 0.85)
			th.set_stylebox(state, "Button", sb)
	# ④ 文本颜色统一（深色底上用浅色字）
	th.set_color("font_color", "Label", Color("#d8e6f5"))
	th.set_color("font_color", "Button", Color("#d8e6f5"))
	th.set_color("font_color", "RichTextLabel", Color("#d8e6f5"))
	th.set_constant("separation", "VBoxContainer", 6)
	th.set_constant("separation", "HBoxContainer", 8)
	return th


static func _tex(path: String) -> Texture2D:
	if ResourceLoader.exists(path):
		var t := load(path)
		if t is Texture2D:
			return t
	return null
