## 确定性随机数（mulberry32）—— 与 `src/core/rng.js` 逐位一致。
##
## 世界生成、掉落、实验科技抽取都走这里：同一个种子必须得到同一张地图。
class_name Rng

var seed: int = 1
var _s: int = 1


func _init(p_seed = 1) -> void:
	if typeof(p_seed) == TYPE_STRING:
		seed = GdMath.hash_str(p_seed)
	else:
		var n := int(p_seed)
		seed = n & GdMath.U32
		if seed == 0:
			seed = 1
	_s = seed


## [0,1) —— 与 JS 的 mulberry32 完全同序
##
## 注意第三行：JS 是 `t ^= t + Math.imul(...)`，其中 `+` 会先算出可能超过 32 位的
## 结果，再由 `^` 触发 ToInt32 截断。GDScript 的 int 是 64 位，不截断就会把
## 高位一起卷进 XOR —— 结果每个数只差 6e-5，看起来「差不多」，
## 但世界生成会完全不同。必须显式 `& U32`。
## （这条就是黄金对比第一次跑出来的 114 个失败。）
func next_f() -> float:
	_s = (_s + 0x6D2B79F5) & GdMath.U32
	var t := _s
	t = GdMath.imul(t ^ (t >> 15), t | 1)
	t ^= (t + GdMath.imul(t ^ (t >> 7), t | 61)) & GdMath.U32
	return float((t ^ (t >> 14)) & GdMath.U32) / 4294967296.0


## [min,max) 浮点
func range_f(min_v: float, max_v: float) -> float:
	return min_v + next_f() * (max_v - min_v)


## [min,max] 整数
func range_i(min_v: int, max_v: int) -> int:
	return int(floor(range_f(float(min_v), float(max_v + 1))))


## 概率命中
func chance(p: float) -> bool:
	return next_f() < p


## 数组随机取一
func pick(arr: Array):
	if arr == null or arr.is_empty():
		return null
	return arr[int(floor(next_f() * arr.size()))]


## 权重抽取。支持 JS 版的四种写法：
##   [{ w = 3, ... }, ...]        对象自带 w 字段（返回对象本身）
##   [{ e = value, w = 3 }, ...]  对象带 e/value/v/t 字段（返回该字段）
##   [[value, weight], ...]       二元组
##   { key: weight, ... }         字典
func weighted(entries) -> Variant:
	var list := normalize_weighted(entries)
	if list.is_empty():
		return null
	var total := 0.0
	for pair in list:
		total += maxf(0.0, float(pair[1]))
	if total <= 0.0:
		return list[0][0]
	var r := next_f() * total
	for pair in list:
		r -= maxf(0.0, float(pair[1]))
		if r <= 0.0:
			return pair[0]
	return list[list.size() - 1][0]


## 把各种权重写法归一化成 [value, weight] 列表
static func normalize_weighted(entries) -> Array:
	var list: Array = []
	if entries is Array:
		for e in entries:
			if e == null:
				continue
			if e is Array:
				list.append([e[0], (e[1] if e.size() > 1 else 0)])
				continue
			if e is Dictionary:
				var w = e.get("w", e.get("weight", e.get("chance", 1)))
				var v = e
				if e.has("e"):
					v = e["e"]
				elif e.has("value") and (e.has("weight") or e.has("w")):
					v = e["value"]
				elif e.has("v") and (e.has("weight") or e.has("w")):
					v = e["v"]
				elif e.has("t") and (e.has("weight") or e.has("w")):
					v = e["t"]
				list.append([v, w])
				continue
			list.append([e, 1])
	elif entries is Dictionary:
		for k in entries.keys():
			list.append([k, entries[k]])
	return list


## 原地洗牌
func shuffle_arr(arr: Array) -> Array:
	for i in range(arr.size() - 1, 0, -1):
		var j := int(floor(next_f() * (i + 1)))
		var t = arr[i]
		arr[i] = arr[j]
		arr[j] = t
	return arr


## 不重复抽 n 个
func sample(arr: Array, n: int) -> Array:
	var copy := arr.duplicate()
	shuffle_arr(copy)
	return copy.slice(0, maxi(0, mini(n, copy.size())))


## 正态分布（Box-Muller 的近似，够用）
func gauss(mean: float = 0.0, sd: float = 1.0) -> float:
	var u := 0.0
	var v := 0.0
	while u == 0.0:
		u = next_f()
	while v == 0.0:
		v = next_f()
	return mean + sd * sqrt(-2.0 * log(u)) * cos(TAU * v)


## 派生一个子 RNG（互不干扰的独立流）
func fork(salt: String = "") -> Rng:
	return Rng.new((seed ^ GdMath.hash_str(salt)) & GdMath.U32)
