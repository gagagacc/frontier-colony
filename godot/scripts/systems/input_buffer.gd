## 输入缓冲 —— `src/core/input.js` 的 `pressedBuffered/consumeBuffered` 移植。
##
## 为什么需要它：玩家在「还不能做这件事」的瞬间按下的键，不该被丢掉。
## 比如站在废墟旁连点 E —— 只要在缓冲窗口内真的执行了动作，这次按键就算数。
##
## 规则（与 JS 一致）：
##   - 没被「当帧立即生效」的按键记进缓冲，**默认窗口 160ms**；
##   - `pressed(action, window)`：当帧按下的直接 true；否则看缓冲时间戳是否还在窗口内；
##   - `consume(action)`：动作真的执行了才消费掉（避免一次按键触发两次）；
##   - 缓冲最多留 800ms，过期自动清理，防止 Map 无限增长。
class_name InputBuffer

const DEFAULT_WINDOW_MS := 160.0
const MAX_KEEP_MS := 800.0

var _buffered: Dictionary = {}      # action -> 按下时刻（毫秒）
var _just_pressed: Dictionary = {}  # 本帧刚按下
var _just_released: Dictionary = {}
var now_ms := 0.0
var enabled := true


func begin_frame(dt: float) -> void:
	now_ms += dt * 1000.0
	_just_pressed.clear()
	_just_released.clear()


## 记一次「刚按下」（由输入层在事件回调里调用）
func press(action: String) -> void:
	_just_pressed[action] = true
	_just_released.erase(action)


func release(action: String) -> void:
	_just_released[action] = true
	_just_pressed.erase(action)


## 这一帧结束：把当帧按下的记进缓冲，并清理过期项（与 JS 的 endFrame 同构）
func end_frame() -> void:
	if not enabled:
		return
	for a in _just_pressed.keys():
		_buffered[a] = now_ms
	var expired: Array = []
	for a in _buffered.keys():
		if now_ms - float(_buffered[a]) > MAX_KEEP_MS:
			expired.append(a)
	for a in expired:
		_buffered.erase(a)
	_just_pressed.clear()
	_just_released.clear()


func just_pressed(action: String) -> bool:
	return _just_pressed.has(action)


func just_released(action: String) -> bool:
	return _just_released.has(action)


## 缓冲判定：当帧按下算数；否则看缓冲里那次按键是否还在窗口内
func pressed(action: String, window_ms: float = DEFAULT_WINDOW_MS) -> bool:
	if not enabled:
		return false
	if _just_pressed.has(action):
		return true
	if not _buffered.has(action):
		return false
	if now_ms - float(_buffered[action]) > window_ms:
		_buffered.erase(action)
		return false
	return true


## 标记已消费（动作真的执行了）
func consume(action: String) -> void:
	_buffered.erase(action)


func clear() -> void:
	_buffered.clear()
	_just_pressed.clear()
	_just_released.clear()


func buffered_count() -> int:
	return _buffered.size()
