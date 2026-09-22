## 设置 —— `src/ui/panelSettings.js` + `src/core/settings.js` 的移植（阶段 12）。
##
## 存到 `user://settings.json`。这一层最容易出的问题是「改了没生效 / 存了没读回」，
## 所以每条设置都有：
##   - 默认值（首次启动、字段缺失、存档损坏都能起来）；
##   - **范围钳制**（音量 0~1、画质 0~2、UI 缩放 0.8~1.4）—— 手改文件也不会把游戏搞崩；
##   - 与 Godot 引擎的实际绑定（音频总线音量、窗口模式、语言）。
class_name Settings

const PATH := "user://settings.json"

const DEFAULTS := {
	"masterVolume": 0.8, "musicVolume": 0.6, "sfxVolume": 0.9, "showGamepadHint": true,
	"quality": 2, "uiScale": 1.0, "language": "zh",
	"showFps": true, "showMinimap": true, "screenShake": 1.0,
	"fullscreen": false, "autoSaveMinutes": 5,
}

const RANGES := {
	"masterVolume": [0.0, 1.0], "musicVolume": [0.0, 1.0], "sfxVolume": [0.0, 1.0],
	"quality": [0.0, 2.0], "uiScale": [0.8, 1.4], "screenShake": [0.0, 1.5],
	"autoSaveMinutes": [1.0, 30.0],
}

const LANGS := ["zh", "en"]

var values: Dictionary = {}


func _init() -> void:
	values = DEFAULTS.duplicate(true)


## 取一项（带钳制）。缺字段/类型不对 → 用默认值。
func get_value(key: String, fallback: Variant = null) -> Variant:
	var v = values.get(key, DEFAULTS.get(key, fallback))
	# 类型不对（手改文件 / 旧版本残留）→ 退回默认值，别把非数字传下去
	if not (v is float or v is int or v is bool or v is String):
		v = DEFAULTS.get(key, fallback)
	if RANGES.has(key):
		var r: Array = RANGES[key]
		if v is float or v is int or v is bool:
			v = clampf(float(v), float(r[0]), float(r[1]))
			if key == "quality" or key == "autoSaveMinutes":
				v = int(round(v))
		else:
			v = DEFAULTS.get(key, fallback)
	return v


func set_value(key: String, v: Variant) -> void:
	values[key] = v
	# 立刻钳制一次，避免把非法值存进文件
	values[key] = get_value(key)


## 把设置应用到引擎（音量总线 / 窗口 / 语言）
## pply_window 默认 false：**启动时不要碰窗口模式**。
## 在 200% 缩放的 Windows 上，一次多余的 window_set_mode 会把窗口
## 按物理像素重建（1280×720 → 2558×1438），截图尺寸跟着变。
## 只有玩家真的切换「全屏」开关时才传 true。
func apply(tree: SceneTree = null, apply_window: bool = false) -> void:
	for bus_name in [["masterVolume", "Master"], ["musicVolume", "Music"], ["sfxVolume", "SFX"]]:
		var idx := AudioServer.get_bus_index(String(bus_name[1]))
		if idx >= 0:
			var v := float(get_value(String(bus_name[0])))
			AudioServer.set_bus_mute(idx, v <= 0.001)
			AudioServer.set_bus_volume_db(idx, linear_to_db(maxf(0.001, v)))
	# ⚠️ 只在**真的需要变**时才动窗口：
	# 之前无条件调 window_set_mode(WINDOWED)，在 200% 缩放的 Windows 上
	# 会把窗口按物理像素重设一遍 —— 截图从 1280×720 变成 2558×1438。
	if tree != null and tree.root != null:
		var want_scale := float(get_value("uiScale"))
		if absf(tree.root.content_scale_factor - want_scale) > 0.001:
			tree.root.content_scale_factor = want_scale
	# 三目运算符**不能跨行**（GDScript 会把换行当成语句结束）—— 这里用 if/else 写
	var want_mode := DisplayServer.WINDOW_MODE_WINDOWED
	if GdMath.truthy(get_value("fullscreen")):
		want_mode = DisplayServer.WINDOW_MODE_FULLSCREEN
	if apply_window and DisplayServer.window_get_mode() != want_mode:
		DisplayServer.window_set_mode(want_mode)


func save() -> bool:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify(values, "  "))
	f.close()
	return true


## 读回；**任何异常都退到默认值**，绝不让设置文件把游戏卡死
func load_settings() -> bool:
	if not FileAccess.file_exists(PATH):
		return false
	var text := FileAccess.get_file_as_string(PATH)
	if text.is_empty():
		return false
	var parsed = JSON.parse_string(text)
	if not (parsed is Dictionary):
		push_warning("设置文件损坏，使用默认值")
		return false
	var d: Dictionary = parsed
	for k in d.keys():
		if DEFAULTS.has(String(k)):
			set_value(String(k), d[k])
	return true
