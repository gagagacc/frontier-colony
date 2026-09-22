## 按键绑定 —— 从 `godot/data/binds.json`（原版 `core/settings.js` 的 DEFAULT_BINDS）建 InputMap。
##
## 为什么必须走数据：原版的键位是**一张可改键的表**，Godot 侧之前是手抄的，
## 结果两版按键完全不同（原版 Space=闪避 / B=建造 / T=科技 / Tab=背包 / M=地图，
## 我抄成了 1=铺基座 / 2=空投塔 / Tab=切页签）。手抄的键位迟早会漂。
##
## JS 的 KeyboardEvent.code → Godot 的 Key 常量，逐个映射；
## 数字键统一成 slot1..slot8（原版快捷栏就是 1-8）。
class_name Binds

## JS code → Godot Key
const CODE_TO_KEY := {
	"KeyW": KEY_W, "KeyA": KEY_A, "KeyS": KEY_S, "KeyD": KEY_D,
	"KeyE": KEY_E, "KeyF": KEY_F, "KeyG": KEY_G, "KeyH": KEY_H,
	"KeyQ": KEY_Q, "KeyR": KEY_R, "KeyT": KEY_T, "KeyV": KEY_V,
	"KeyB": KEY_B, "KeyC": KEY_C, "KeyM": KEY_M, "KeyX": KEY_X,
	"KeyZ": KEY_Z, "KeyP": KEY_P,
	"Digit1": KEY_1, "Digit2": KEY_2, "Digit3": KEY_3, "Digit4": KEY_4,
	"Digit5": KEY_5, "Digit6": KEY_6, "Digit7": KEY_7, "Digit8": KEY_8,
	"Space": KEY_SPACE, "Tab": KEY_TAB, "Escape": KEY_ESCAPE,
	"ShiftLeft": KEY_SHIFT, "ShiftRight": KEY_SHIFT,
	"ArrowUp": KEY_UP, "ArrowDown": KEY_DOWN, "ArrowLeft": KEY_LEFT, "ArrowRight": KEY_RIGHT,
}


static func defaults() -> Dictionary:
	var d: Dictionary = DataLoader.new().module("binds").get("DEFAULT_BINDS", {})
	return d


## 把 binds.json 里的键位写进 Godot 的 InputMap（动作名与 JS 完全一致）
##
## 返回新增的事件数。**幂等**：重复调用不会重复添加。
static func apply_to_input_map() -> int:
	var added := 0
	var binds := defaults()
	for action in binds.keys():
		var a := String(action)
		if not InputMap.has_action(a):
			InputMap.add_action(a, 0.2)
		var codes: Array = binds[action]
		for code in codes:
			var key = CODE_TO_KEY.get(String(code), null)
			if key == null:
				continue
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			if not InputMap.action_has_event(a, ev):
				InputMap.action_add_event(a, ev)
				added += 1
	return added


## 玩家自定义的键位（设置里改过的）覆盖默认表
static func apply_overrides(overrides: Dictionary) -> int:
	var added := 0
	for action in overrides.keys():
		var a := String(action)
		if not InputMap.has_action(a):
			InputMap.add_action(a, 0.2)
		InputMap.action_erase_events(a)
		var codes = overrides[action]
		if codes is String:
			codes = [codes]
		if codes is Array:
			for code in codes:
				var key = CODE_TO_KEY.get(String(code), null)
				if key == null:
					continue
				var ev := InputEventKey.new()
				ev.physical_keycode = key
				InputMap.action_add_event(a, ev)
				added += 1
	return added


## 调试/UI 用：某个动作现在绑了哪些键（人类可读）
static func describe(action: String) -> String:
	var names: Array = []
	for ev in InputMap.action_get_events(action):
		if ev is InputEventKey:
			names.append(OS.get_keycode_string((ev as InputEventKey).physical_keycode))
	return " / ".join(names)
