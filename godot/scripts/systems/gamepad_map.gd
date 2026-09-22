## 手柄映射 —— `src/core/gamepad.js` 的映射表与阈值规则移植（阶段 13 缺口之一）。
##
## 设计原则（照搬 JS 的三条）：
##   1) 手柄**不另起一套输入通道**：它把按键注入成和键盘完全相同的动作名；
##   2) 面板用「空间导航」：A 确认、B 返回、肩键切页签，不需要鼠标；
##   3) 手柄与键鼠随时混用（动鼠标切回来、碰摇杆切过去）。
##
## 这里只搬**映射与阈值**（纯数据 + 纯函数，可以逐值比对）；
## 真正接到 Godot 的 InputMap 是下一步（`apply_to_input_map()`），
## 那样 `Input.is_action_pressed("fire")` 就能同时吃到键盘和手柄。
class_name GamepadMap

## 标准手柄按钮索引（与 JS 的 B 表一致）
const B := {
	"A": 0, "B": 1, "X": 2, "Y": 3,
	"LB": 4, "RB": 5, "LT": 6, "RT": 7,
	"BACK": 8, "START": 9,
	"L3": 10, "R3": 11,
	"UP": 12, "DOWN": 13, "LEFT": 14, "RIGHT": 15,
	"GUIDE": 16,
}

## 战斗按键映射：[按钮索引, 动作名, 是否鼠标类, 是否开关类, 是否按住类]
const COMBAT_BUTTONS := [
	{ "button": 7, "action": "fire", "mouse": true, "toggle": false, "hold": false, "label": "开火" },
	{ "button": 0, "action": "interact", "mouse": false, "toggle": false, "hold": true, "label": "采集/交互" },
	{ "button": 1, "action": "dodge", "mouse": false, "toggle": true, "hold": false, "label": "闪避" },
	{ "button": 2, "action": "attackAlt", "mouse": true, "toggle": false, "hold": false, "label": "攻击" },
	{ "button": 3, "action": "build", "mouse": false, "toggle": true, "hold": false, "label": "建造" },
	{ "button": 6, "action": "reload", "mouse": false, "toggle": true, "hold": false, "label": "装填" },
	{ "button": 5, "action": "sprint", "mouse": false, "toggle": false, "hold": true, "label": "冲刺" },
	{ "button": 14, "action": "prevWeapon", "mouse": false, "toggle": true, "hold": false, "label": "上一把武器" },
	{ "button": 15, "action": "nextWeapon", "mouse": false, "toggle": true, "hold": false, "label": "下一把武器" },
	{ "button": 10, "action": "swapWeapon", "mouse": false, "toggle": true, "hold": false, "label": "切换武器" },
	{ "button": 11, "action": "takeover", "mouse": false, "toggle": true, "hold": false, "label": "接管炮塔" },
	{ "button": 9, "action": "pause", "mouse": false, "toggle": true, "hold": false, "label": "暂停" },
]

## 面板导航按键（面板打开时接管）
const UI_BUTTONS := [
	{ "button": 0, "action": "uiAccept", "label": "确认" },
	{ "button": 1, "action": "uiBack", "label": "返回" },
	{ "button": 4, "action": "uiTabPrev", "label": "上一页签" },
	{ "button": 5, "action": "uiTabNext", "label": "下一页签" },
	{ "button": 12, "action": "uiUp", "label": "上" },
	{ "button": 13, "action": "uiDown", "label": "下" },
	{ "button": 14, "action": "uiLeft", "label": "左" },
	{ "button": 15, "action": "uiRight", "label": "右" },
]

const DEADZONE := 0.18
const TRIGGER_THRESHOLD := 0.35
const AIM_THRESHOLD := 0.28
const BACK_LONG_PRESS := 0.6

## 摇杆死区处理（与 JS 的摇杆读取同式：死区内归零，之后按 1/(1-dead) 归一）
static func apply_deadzone(x: float, y: float, dead: float = DEADZONE) -> Vector2:
	var mag := sqrt(x * x + y * y)
	if mag < dead:
		return Vector2.ZERO
	var scale := (mag - dead) / (1.0 - dead) / mag
	return Vector2(x * scale, y * scale)


## 扳机是否算按下
static func trigger_pressed(value: float) -> bool:
	return value >= TRIGGER_THRESHOLD


## 右摇杆是否够大、可以当瞄准（并自动开火）
static func aim_active(x: float, y: float) -> bool:
	return sqrt(x * x + y * y) >= AIM_THRESHOLD


## BACK 键：短按开地图 / 长按呼救
static func back_action(hold_seconds: float) -> String:
	return "callWave" if hold_seconds >= BACK_LONG_PRESS else "map"


func action_for_button(button: int) -> String:
	for b in COMBAT_BUTTONS:
		if int(b["button"]) == button:
			return String(b["action"])
	return ""


func label_for_button(button: int) -> String:
	for b in COMBAT_BUTTONS:
		if int(b["button"]) == button:
			return String(b["label"])
	return ""


func is_toggle_action(action: String) -> bool:
	for b in COMBAT_BUTTONS:
		if String(b["action"]) == action:
			return GdMath.truthy(b["toggle"])
	return false


## 把映射写进 Godot 的 InputMap（手柄与键盘共用同一批动作名）
##
## 这是「手柄不另起一套输入通道」那条原则在 Godot 里的落地方式：
## 动作名保持一致，游戏逻辑完全不用区分输入设备。
static func apply_to_input_map() -> int:
	var n := 0
	for b in COMBAT_BUTTONS + UI_BUTTONS:
		var action := String(b["action"])
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.2)
		var ev := InputEventJoypadButton.new()
		ev.button_index = int(b["button"]) as JoyButton
		if not InputMap.action_has_event(action, ev):
			InputMap.action_add_event(action, ev)
			n += 1
	# 摇杆：左摇杆移动、右摇杆瞄准
	var axes := [
		{ "action": "moveLeft", "axis": JOY_AXIS_LEFT_X, "value": -1.0 },
		{ "action": "moveRight", "axis": JOY_AXIS_LEFT_X, "value": 1.0 },
		{ "action": "moveUp", "axis": JOY_AXIS_LEFT_Y, "value": -1.0 },
		{ "action": "moveDown", "axis": JOY_AXIS_LEFT_Y, "value": 1.0 },
		{ "action": "aimLeft", "axis": JOY_AXIS_RIGHT_X, "value": -1.0 },
		{ "action": "aimRight", "axis": JOY_AXIS_RIGHT_X, "value": 1.0 },
		{ "action": "aimUp", "axis": JOY_AXIS_RIGHT_Y, "value": -1.0 },
		{ "action": "aimDown", "axis": JOY_AXIS_RIGHT_Y, "value": 1.0 },
	]
	for a in axes:
		var action2 := String(a["action"])
		if not InputMap.has_action(action2):
			InputMap.add_action(action2, float(DEADZONE))
		var ev2 := InputEventJoypadMotion.new()
		ev2.axis = int(a["axis"]) as JoyAxis
		ev2.axis_value = float(a["value"])
		if not InputMap.action_has_event(action2, ev2):
			InputMap.action_add_event(action2, ev2)
			n += 1
	return n
