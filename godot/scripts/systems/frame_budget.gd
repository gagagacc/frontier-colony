## 逐帧预算：区块生成与流场重算都不能在某一阵里做完。
##
## 「走路一卡一卡」的两个来源（实测）：
##   1. `props.ensure_around()` 每帧都调，玩家一走就触发**一批**新区块生成，
##      每块要做噪声 + 采样 + 建道具 —— 一帧里做完就掉帧；
##   2. `FlowField.compute()` 在玩家移动超过 4 格时重算，一次约 90ms，
##      也是一帧里做完。
##
## 这个类的职责很简单：**把「一帧要做多少」这件事集中管起来**，
## 让上层只说「我需要这块区域」，由它决定这一帧先从哪儿开始做。
class_name FrameBudget

## 一帧最多生成几个区块（一个区块 16×16 格）
const CHUNKS_PER_FRAME := 1
## 流场重算的最小间隔（秒）——比「移动 4 格」更保守，避免连续移动时连环重算
const FLOW_MIN_INTERVAL := 0.35

var _chunk_budget := 0
var _pending: Array = []          # 待生成的区块坐标队列
var _last_flow_at := -999.0
var now := 0.0
var flow_calls := 0
var chunks_this_second := 0
var _second_mark := 0.0


func tick(dt: float) -> void:
	now += dt
	_chunk_budget = CHUNKS_PER_FRAME
	if now - _second_mark >= 1.0:
		_second_mark = now
		chunks_this_second = 0


## 请求「玩家附近要保证已生成」；返回这一帧真正生成的区块数
func pump_chunks(props: Props, x: float, y: float, radius_px: float) -> int:
	var made := 0
	# 先把要生成的区块排进队列（按「离玩家近」优先）
	if _pending.is_empty():
		_pending = props.missing_chunks(x, y, radius_px)
	while _chunk_budget > 0 and not _pending.is_empty():
		var c: Vector2i = _pending.pop_front()
		props.spawn_chunk(c.x, c.y)
		_chunk_budget -= 1
		made += 1
		chunks_this_second += 1
	return made


## 流场要不要现在重算（节流：至少间隔 FLOW_MIN_INTERVAL）
func allow_flow() -> bool:
	if now - _last_flow_at < FLOW_MIN_INTERVAL:
		return false
	_last_flow_at = now
	flow_calls += 1
	return true


func reset() -> void:
	_pending.clear()
	_last_flow_at = -999.0
