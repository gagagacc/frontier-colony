## 异步流场：把 90~110ms 的重算挪到后台线程，主线程照常渲染。
##
## 为什么必须这么做（实测数据，`tests/probe_hitch.gd`）：
##   修前 —— 每帧平均 4.82ms，但**最慢一帧 107.92ms**，而且每 0.35 秒来一次。
##   那就是玩家说的「走路一卡一卡」：不是帧率低，是**规律性的长冻结**。
##
## 做法是双缓冲：
##   - 主线程继续用**当前**的流场（旧的目标点，敌人照走，看不出来）；
##   - 后台线程往**另一份**缓冲里算新的；
##   - 算完由主线程 `poll()` 交换，交换本身是 O(1)。
class_name AsyncFlow

var _front: FlowField = null      # 正在用的
var _back: FlowField = null       # 正在算的
var _thread: Thread = null
var _busy := false
var _goal := Vector2i(-9999, -9999)
var _want_goal := Vector2i(-9999, -9999)
var _tiles: PackedByteArray = PackedByteArray()
var _last_ms := 0
var compute_count := 0
var swap_count := 0


func _init() -> void:
	_front = FlowField.new(Cfg.WORLD_TILES, Cfg.WORLD_TILES, Cfg.FLOW_CELL)
	_back = FlowField.new(Cfg.WORLD_TILES, Cfg.WORLD_TILES, Cfg.FLOW_CELL)


## 请求以 goal 为目标重算；**不阻塞**。后台忙时会记住目标，等这次算完再补
func request(goal: Vector2i, tiles: PackedByteArray) -> bool:
	_want_goal = goal
	_tiles = tiles
	if _busy:
		return false
	_busy = true
	_goal = goal
	if _thread == null:
		_thread = Thread.new()
		var err := _thread.start(_worker)
		if err != OK:
			# 起不了线程就退回同步算（宁可卡一下，也不能没有流场）
			_busy = false
			_thread = null
			var t0 := Time.get_ticks_msec()
			_front.compute(goal.x, goal.y, tiles)
			_last_ms = Time.get_ticks_msec() - t0
			compute_count += 1
			return true
	return true


func _worker() -> void:
	var t0 := Time.get_ticks_msec()
	_back.compute(_goal.x, _goal.y, _tiles)
	_last_ms = Time.get_ticks_msec() - t0


## 每帧调一次：算完就交换，并在有排队目标时立刻接着算
func poll() -> void:
	if not _busy or _thread == null:
		return
	if _thread.is_alive():
		return
	_thread.wait_to_finish()
	# 交换前后缓冲（O(1)：只换指针）
	var tmp := _front
	_front = _back
	_back = tmp
	_goal = _want_goal
	swap_count += 1
	compute_count += 1
	_busy = false
	# 排队的目标和刚算完的不一样，就接着算下一帧要用的
	if _front.goal != _want_goal:
		request(_want_goal, _tiles)


func field() -> FlowField:
	return _front


func is_busy() -> bool:
	return _busy


func last_ms() -> int:
	return _last_ms


func stop() -> void:
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null
	_busy = false
