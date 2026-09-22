## 空间哈希（邻居查询）—— `src/world/spatialHash.js` 的移植。
##
## 敌人分离、索敌、爆炸判定都靠它。每帧重建一次（O(n)）比维护动态索引更简单也更稳。
class_name SpatialHash

var cell: float
var map: Dictionary = {}
var _stamp := 0


func _init(cell_size: float = 72.0) -> void:
	cell = cell_size


func clear() -> void:
	map.clear()


## 与 JS 一致：两个大质数乘积的异或。
## 注意 JS 的 `^` 会对每个操作数做 ToInt32（乘积早就超过 32 位了），
## 所以各自先掩到 32 位再异或 —— 否则大坐标下桶键会与 JS 不同。
static func _key(cx: int, cy: int) -> int:
	return (((cx * 73856093) & GdMath.U32) ^ ((cy * 19349663) & GdMath.U32))


## 把一个实体插进它覆盖的所有格子（半径跨格时要插多个）
func insert(ent, radius: float = 0.0) -> void:
	var x0 := int(floor((float(ent.x) - radius) / cell))
	var x1 := int(floor((float(ent.x) + radius) / cell))
	var y0 := int(floor((float(ent.y) - radius) / cell))
	var y1 := int(floor((float(ent.y) + radius) / cell))
	for cy in range(y0, y1 + 1):
		for cx in range(x0, x1 + 1):
			var k := _key(cx, cy)
			if map.has(k):
				map[k].append(ent)
			else:
				map[k] = [ent]


## 填充所有实体（跳过 dead）
func build(list: Array, radius_of: Callable = Callable()) -> void:
	clear()
	for e in list:
		if GdMath.truthy(e.get("dead")) if e is Dictionary else GdMath.truthy(e.dead):
			continue
		var r := float(radius_of.call(e)) if radius_of.is_valid() else float(e.get("r") if e is Dictionary else e.r)
		insert(e, r)


## 查询圆形范围内的实体。
## 用「代号标记」去重（实体可能同时落在多个格子里），并像 JS 一样
## 把目标半径算进去：dx²+dy² <= (r + e.r)²。
func query(x: float, y: float, r: float, out: Array = []) -> Array:
	out.clear()
	var x0 := int(floor((x - r) / cell))
	var x1 := int(floor((x + r) / cell))
	var y0 := int(floor((y - r) / cell))
	var y1 := int(floor((y + r) / cell))
	_stamp += 1
	var stamp := _stamp
	for cy in range(y0, y1 + 1):
		for cx in range(x0, x1 + 1):
			var bucket = map.get(_key(cx, cy), null)
			if bucket == null:
				continue
			for e in bucket:
				if int(e.get("_qstamp", -1)) == stamp:
					continue
				e["_qstamp"] = stamp
				var dx := float(e.x) - x
				var dy := float(e.y) - y
				var rr := r + float(e.get("r", 0.0))
				if dx * dx + dy * dy <= rr * rr:
					out.append(e)
	return out


## 找最近的单个目标（filter 可选）
func nearest(x: float, y: float, r: float, filter: Callable = Callable()):
	var x0 := int(floor((x - r) / cell))
	var x1 := int(floor((x + r) / cell))
	var y0 := int(floor((y - r) / cell))
	var y1 := int(floor((y + r) / cell))
	var best = null
	var best_d := r * r
	_stamp += 1
	var stamp := _stamp
	for cy in range(y0, y1 + 1):
		for cx in range(x0, x1 + 1):
			var bucket = map.get(_key(cx, cy), null)
			if bucket == null:
				continue
			for e in bucket:
				if int(e.get("_qstamp", -1)) == stamp or GdMath.truthy(e.get("dead", false)):
					continue
				e["_qstamp"] = stamp
				if filter.is_valid() and not GdMath.truthy(filter.call(e)):
					continue
				var dx := float(e.x) - x
				var dy := float(e.y) - y
				var d := dx * dx + dy * dy
				if d < best_d:
					best_d = d
					best = e
	return best
