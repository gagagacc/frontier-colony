## 主菜单与角色选择 —— 对应 JS 版的落地界面（`panelPlanet`/启动流程）。
##
## 它决定「一局怎么开始」，所以这里只做**选择 → 开局参数**这一段纯逻辑，
## 界面本身用 Control 拼（`build_ui()`），这样可以在 headless 里断言，
## 也能被截图工具驱动。
##
## 开局参数 = 模式（开拓/纯塔防）+ 角色（4 选 1）+ 种子。
## 三样都会真的影响世界生成与属性装配：
##   - 模式 → `nestScale/poiScale/compact`（塔防不撒巢穴）、有没有角色、建造半径；
##   - 角色 → 基础属性 + 被动（修塔折扣、塔上限、近战、载具位、基因位）。
class_name MainMenu

const SEED_PREFIX := "frontier-"

var mode := "frontier"
var character := "engineer"
var seed_text := ""
var mode_list: Array = []
var char_list: Array = []
var continue_available := false


func _init() -> void:
	var modes: Dictionary = DataLoader.new().module("modes")
	mode_list = modes.get("MODE_LIST", ["frontier", "towerDefense"])
	var chars: Dictionary = DataLoader.new().module("characters")
	char_list = chars.get("CHAR_LIST", ["engineer"])
	seed_text = random_seed_text()


static func random_seed_text() -> String:
	return SEED_PREFIX + str(randi() % 900 + 100)


func mode_defs() -> Array:
	var defs: Dictionary = DataLoader.new().module("modes").get("MODE_DEF", {})
	var out: Array = []
	for id in mode_list:
		out.append(defs.get(String(id), {}))
	return out


func char_defs() -> Array:
	var defs: Dictionary = DataLoader.new().module("characters").get("CHAR_DEF", {})
	var out: Array = []
	for id in char_list:
		out.append(defs.get(String(id), {}))
	return out


func select_mode(id: String) -> bool:
	if not mode_list.has(id):
		return false
	mode = id
	# 纯塔防模式没有角色操控：角色仍然选（属性还在用），但界面会标注出来
	return true


func select_character(id: String) -> bool:
	if not char_list.has(id):
		return false
	character = id
	return true


## 开局参数（真正喂给世界生成与属性装配的那一份）
func start_params() -> Dictionary:
	var modes: Dictionary = DataLoader.new().module("modes")
	var mdef: Dictionary = modes.get("MODE_DEF", {}).get(mode, {})
	var chars: Dictionary = DataLoader.new().module("characters")
	var cdef: Dictionary = chars.get("CHAR_DEF", {}).get(character, {})
	var w: Dictionary = mdef.get("world", {})
	return {
		"mode": mode,
		"character": character,
		"seed": seed_text if seed_text != "" else random_seed_text(),
		"planetIndex": 0,
		# ⚠️ 这里必须用 num()（只在「键缺失」时兜底）而不是 num_or()：
		# 塔防模式的 nestScale **就是 0**（不撒巢穴）—— 用 num_or 会把 0 当成「没值」
		# 而换成默认的 1.0，于是塔防模式照样长出一堆虫巢。
		"nestScale": DataLoader.num(w, "nestScale", 1.0),
		"poiScale": DataLoader.num(w, "poiScale", 1.0),
		"compact": GdMath.truthy(w.get("compact", false)),
		"hasPlayer": GdMath.truthy(mdef.get("hasPlayer", true)),
		"fieldRadius": DataLoader.num(mdef, "fieldRadius", 900.0),
		"startResources": mdef.get("startResources", {}),
		"base": cdef.get("base", {}),
		"passive": cdef.get("passive", {}),
	}


## 开局属性：角色基础 + 被动里的数值项（机制类的键由 StatSet 自己处理）
func starting_stats() -> StatSet:
	var p := start_params()
	var ss := StatSet.new(p["base"])
	var passive: Dictionary = p["passive"]
	var numeric: Dictionary = {}
	for k in passive.keys():
		var v = passive[k]
		if v is float or v is int:
			numeric[String(k)] = float(v)
	if not numeric.is_empty():
		ss.add(numeric)
	return ss


# =========================================================
#  界面（Control）
# =========================================================

## root 参数故意用 Node（$UI 是 CanvasLayer，不是 Control）—— 界面挂在哪一层由调用方决定
func build_ui(root: Node, on_start: Callable, on_continue: Callable = Callable()) -> Control:
	var layer := Control.new()
	layer.name = "MainMenu"
	layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(layer)
	var panel := UiPanels.make_window("开拓者：殖民地", Vector2(860, 560))
	panel.position = Vector2(210, 80)
	layer.add_child(panel)
	var body: Node = panel.get_node_or_null("Body")
	if body == null:
		return layer

	var sub := Label.new()
	sub.text = "选择模式与角色，然后落地。"
	sub.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(sub)

	var mh := Label.new()
	mh.text = "— 模式 —"
	mh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(mh)
	var mrow := HBoxContainer.new()
	for d in mode_defs():
		var id := String(d.get("id", ""))
		var b := Button.new()
		b.text = "%s %s" % [String(d.get("icon", "")), String(d.get("name", id))]
		b.disabled = (id == mode)
		b.tooltip_text = String(d.get("tagline", ""))
		b.pressed.connect(func() -> void:
			select_mode(id)
			rebuild(root, on_start, on_continue))
		mrow.add_child(b)
	body.add_child(mrow)
	var mdesc := Label.new()
	var cur_mode: Dictionary = {}
	for d in mode_defs():
		if String(d.get("id", "")) == mode:
			cur_mode = d
	mdesc.text = "  " + String(cur_mode.get("tagline", ""))
	mdesc.add_theme_font_size_override("font_size", 13)
	body.add_child(mdesc)

	var ch := Label.new()
	ch.text = "— 角色 —"
	ch.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(ch)
	for d in char_defs():
		var id2 := String(d.get("id", ""))
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = "%s%s" % ["▶ " if id2 == character else "   ", String(d.get("name", id2))]
		l.custom_minimum_size = Vector2(160, 0)
		var q := Label.new()
		q.text = String(d.get("tagline", ""))
		q.add_theme_color_override("font_color", Color("#c9d4e0"))
		var b2 := Button.new()
		b2.text = "选择"
		b2.disabled = (id2 == character)
		b2.pressed.connect(func() -> void:
			select_character(id2)
			rebuild(root, on_start, on_continue))
		row.add_child(l)
		row.add_child(q)
		row.add_child(b2)
		body.add_child(row)

	var sh := Label.new()
	sh.text = "— 种子（决定整张地图） —"
	sh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(sh)
	var srow := HBoxContainer.new()
	var seed_edit := LineEdit.new()
	seed_edit.text = seed_text
	seed_edit.custom_minimum_size = Vector2(320, 0)
	seed_edit.text_changed.connect(func(t: String) -> void: seed_text = t)
	srow.add_child(seed_edit)
	var reroll := Button.new()
	reroll.text = "随机"
	reroll.pressed.connect(func() -> void:
		seed_text = random_seed_text()
		rebuild(root, on_start, on_continue))
	srow.add_child(reroll)
	body.add_child(srow)

	var brow := HBoxContainer.new()
	var start := Button.new()
	start.text = "开始游戏"
	start.pressed.connect(func() -> void: on_start.call(start_params()))
	brow.add_child(start)
	if on_continue.is_valid():
		var cont := Button.new()
		cont.text = "继续上次存档"
		cont.disabled = not continue_available
		cont.pressed.connect(func() -> void: on_continue.call())
		brow.add_child(cont)
	body.add_child(brow)
	return layer


## 选择变了就重建界面（按钮的禁用态/标记要跟着变）
func rebuild(root: Node, on_start: Callable, on_continue: Callable = Callable()) -> void:
	for child in root.get_children():
		if String(child.name) == "MainMenu":
			child.queue_free()
	build_ui(root, on_start, on_continue)
