## 流场寻路（Dijkstra 距离场）—— `src/world/pathfind.js` 的移植。
##
## 为什么不用 A*：怪潮可能同时有 300+ 单位，逐个 A* 会卡。流场只在
## 「目标变化」时算一次，所有单位共享，而且天然产生绕开岩壁的群体行为。
##
## 两个必须照搬的细节：
##   1. **代价量化成整数**（Q = 256）。斜向含 √2，浮点累加会造出 1e-13 级的
##      「更优路径」，节点被反复松弛、堆无限膨胀、Dijkstra 永不收敛。
##   2. **降采样 cell**：一个流场格 = cell×cell 地块，取最差的那块
##      （有实心就整格不可走），节点数降到 1/cell²。
class_name FlowField

const NEIGHBORS := [
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1),
]
## 与 NEIGHBORS 对应的代价倍数
const NEIGHBOR_MULT := [1.0, 1.0, 1.0, 1.0, sqrt(2.0), sqrt(2.0), sqrt(2.0), sqrt(2.0)]
const Q := 256

var cell: int
var w: int
var h: int
var tiles_w: int
var tiles_h: int

var dist: PackedFloat32Array          # 到目标的量化代价
var dir_x: PackedFloat32Array
var dir_y: PackedFloat32Array
var stamp: PackedInt32Array
var generation := 0
var goal := Vector2i(-1, -1)
var max_cost := INF
var neighbor_cost: PackedInt32Array

var _cost: PackedFloat32Array
var _heap_idx: PackedInt32Array
var _heap_d: PackedInt32Array
var _heap_n := 0


func _init(p_w: int, p_h: int, p_cell: int = 1) -> void:
	cell = maxi(1, p_cell)
	w = int(ceil(float(p_w) / float(cell)))
	h = int(ceil(float(p_h) / float(cell)))
	tiles_w = p_w
	tiles_h = p_h

	var n := w * h
	dist = PackedFloat32Array()
	dist.resize(n)
	dist.fill(INF)
	dir_x = PackedFloat32Array()
	dir_x.resize(n)
	dir_y = PackedFloat32Array()
	dir_y.resize(n)
	stamp = PackedInt32Array()
	stamp.resize(n)
	stamp.fill(-1)
	_cost = PackedFloat32Array()
	_cost.resize(n)
	_heap_idx = PackedInt32Array()
	_heap_idx.resize(n * 4)
	_heap_d = PackedInt32Array()
	_heap_d.resize(n * 4)

	neighbor_cost = PackedInt32Array()
	neighbor_cost.resize(8)
	for i in 8:
		neighbor_cost[i] = int(round(float(Cfg.TILE) * NEIGHBOR_MULT[i] * float(Q)))


## 静态地形代价（越小越好走），INF = 不可通行
func terrain_cost(tile_id: int) -> float:
	var solid := Cfg.is_solid_tile(tile_id)
	if solid:
		return INF
	var sp := _tile_speed(tile_id)
	return INF if sp <= 0.0 else 1.0 / sp


var _speed_cache: Dictionary = {}

func _tile_speed(tile_id: int) -> float:
	if _speed_cache.has(tile_id):
		return _speed_cache[tile_id]
	var defs: Dictionary = _tile_defs()
	var d = defs.get(str(tile_id), defs.get(tile_id, null))
	var sp := 1.0
	if d is Dictionary and d.has("speed"):
		sp = float(d["speed"])
	_speed_cache[tile_id] = sp
	return sp


var _defs_loader: DataLoader = null

func _tile_defs() -> Dictionary:
	if _defs_loader == null:
		_defs_loader = DataLoader.new()
	return _defs_loader.table("tiles", "TILE_DEF", {})


## 目标格（世界坐标，像素）→ 流场格
func cell_of(wx: float, wy: float) -> Vector2i:
	return Vector2i(int(floor(wx / float(Cfg.TILE * cell))), int(floor(wy / float(Cfg.TILE * cell))))


## 把「地块级地形」压成「流场格级代价」；blocked 是可选的地块级回调
func _bake_cost(tiles: PackedByteArray, blocked: PackedByteArray) -> void:
	for cy in h:
		for cx in w:
			var worst := 0.0
			var solid := false
			var tx0 := cx * cell
			var ty0 := cy * cell
			for dy in cell:
				if solid:
					break
				var ty := ty0 + dy
				if ty >= tiles_h:
					solid = true
					break
				for dx in cell:
					var tx := tx0 + dx
					if tx >= tiles_w:
						solid = true
						break
					if blocked != null and not blocked.is_empty() and blocked[ty * tiles_w + tx] != 0:
						solid = true
						break
					var c := terrain_cost(tiles[ty * tiles_w + tx])
					if not is_finite(c):
						solid = true
						break
					if c > worst:
						worst = c
			_cost[cy * w + cx] = INF if solid else worst


## 以 (gx,gy) 为目标重算整张流场（gx/gy 是**地块**坐标）
func compute(gx: int, gy: int, tiles: PackedByteArray, blocked: PackedByteArray = PackedByteArray()) -> void:
	generation += 1
	var gen := generation

	var cx := int(floor(float(gx) / float(cell)))
	var cy := int(floor(float(gy) / float(cell)))
	goal = Vector2i(cx, cy)
	if cx < 0 or cy < 0 or cx >= w or cy >= h:
		return

	_bake_cost(tiles, blocked)

	_heap_n = 0
	var start := cy * w + cx
	# 目标格本身就算是实心的也要让流场成立（基地被墙围住的情况）
	dist[start] = 0.0
	stamp[start] = gen
	dir_x[start] = 0.0
	dir_y[start] = 0.0
	_heap_push(start, 0)

	var max_c := 0
	var guard := 0
	var guard_limit := w * h * 12

	while _heap_n > 0:
		guard += 1
		if guard > guard_limit:
			push_warning("[flow] 迭代超限，强制结束")
			break
		var node := _heap_pop()
		var idx: int = node[0]
		var d: int = node[1]
		if d > int(dist[idx]):
			continue                       # 过期条目
		if d > max_c:
			max_c = d
		var x := idx % w
		var y := (idx - x) / w

		for n in 8:
			var nb: Vector2i = NEIGHBORS[n]
			var nx := x + nb.x
			var ny := y + nb.y
			if nx < 0 or ny < 0 or nx >= w or ny >= h:
				continue
			var n_idx := ny * w + nx
			var c := _cost[n_idx]
			if not is_finite(c):
				continue
			# 斜向不允许穿过两个墙角
			if nb.x != 0 and nb.y != 0:
				if not is_finite(_cost[y * w + nx]):
					continue
				if not is_finite(_cost[ny * w + x]):
					continue
			var step := int(round(c * float(neighbor_cost[n])))
			var nd := d + step
			if stamp[n_idx] != gen:
				stamp[n_idx] = gen
				dist[n_idx] = float(nd)
				_heap_push(n_idx, nd)
			elif nd < int(dist[n_idx]):
				dist[n_idx] = float(nd)
				_heap_push(n_idx, nd)

	max_cost = float(max_c)

	# 第二遍：每格指向距离最小的邻居
	for y in h:
		for x in w:
			var idx := y * w + x
			if stamp[idx] != gen or (x == cx and y == cy):
				dir_x[idx] = 0.0
				dir_y[idx] = 0.0
				continue
			var bd := dist[idx]
			var bx := 0
			var by := 0
			for n in 8:
				var nb: Vector2i = NEIGHBORS[n]
				var nx := x + nb.x
				var ny := y + nb.y
				if nx < 0 or ny < 0 or nx >= w or ny >= h:
					continue
				var n_idx := ny * w + nx
				if stamp[n_idx] != gen:
					continue
				if dist[n_idx] < bd:
					bd = dist[n_idx]
					bx = nb.x
					by = nb.y
			var ln := sqrt(float(bx * bx + by * by))
			if ln == 0.0:
				ln = 1.0
			dir_x[idx] = float(bx) / ln
			dir_y[idx] = float(by) / ln


## 世界坐标处应该往哪走 → { x, y, ok, dist }
func sample(wx: float, wy: float) -> Dictionary:
	var gx := int(floor(wx / float(Cfg.TILE * cell)))
	var gy := int(floor(wy / float(Cfg.TILE * cell)))
	if gx < 0 or gy < 0 or gx >= w or gy >= h:
		return { "x": 0.0, "y": 0.0, "ok": false }
	var idx := gy * w + gx
	if stamp[idx] != generation:
		return { "x": 0.0, "y": 0.0, "ok": false }
	return { "x": dir_x[idx], "y": dir_y[idx], "ok": true, "dist": dist[idx] }


## 该点到目标的剩余路程（量化单位），不可达返回 INF
func cost_at(wx: float, wy: float) -> float:
	var gx := int(floor(wx / float(Cfg.TILE * cell)))
	var gy := int(floor(wy / float(Cfg.TILE * cell)))
	if gx < 0 or gy < 0 or gx >= w or gy >= h:
		return INF
	var idx := gy * w + gx
	return dist[idx] if stamp[idx] == generation else INF


func ready() -> bool:
	return goal.x >= 0 and generation > 0


# ---- 极简二叉堆（索引 + 距离两个平行数组，避免每帧造对象）----

func _heap_push(idx: int, d: int) -> void:
	if _heap_n >= _heap_idx.size():
		_heap_idx.resize(_heap_idx.size() * 2)
		_heap_d.resize(_heap_d.size() * 2)
	_heap_idx[_heap_n] = idx
	_heap_d[_heap_n] = d
	var i := _heap_n
	_heap_n += 1
	while i > 0:
		var p := (i - 1) >> 1
		if _heap_d[p] <= _heap_d[i]:
			break
		var ti := _heap_idx[p]
		var td := _heap_d[p]
		_heap_idx[p] = _heap_idx[i]
		_heap_d[p] = _heap_d[i]
		_heap_idx[i] = ti
		_heap_d[i] = td
		i = p


func _heap_pop() -> Array:
	var top_idx := _heap_idx[0]
	var top_d := _heap_d[0]
	_heap_n -= 1
	if _heap_n > 0:
		_heap_idx[0] = _heap_idx[_heap_n]
		_heap_d[0] = _heap_d[_heap_n]
		var i := 0
		while true:
			var l := i * 2 + 1
			var r := l + 1
			var s := i
			if l < _heap_n and _heap_d[l] < _heap_d[s]:
				s = l
			if r < _heap_n and _heap_d[r] < _heap_d[s]:
				s = r
			if s == i:
				break
			var ti := _heap_idx[s]
			var td := _heap_d[s]
			_heap_idx[s] = _heap_idx[i]
			_heap_d[s] = _heap_d[i]
			_heap_idx[i] = ti
			_heap_d[i] = td
			i = s
	return [top_idx, top_d]
