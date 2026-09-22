## 值噪声 / 分形 / 细胞噪声 —— 与 `src/core/noise.js` 逐位一致。
##
## 地形高程、湿度、生物群系、巢穴分布、矿区成簇全靠它。
## 哈希必须完全复刻（同一个种子 → 同一张地图）。
class_name GdNoise

const U32 := 0xFFFFFFFF


## 与 JS `hash2(x, y, seed)` 一致。
##
## **这里必须在浮点里算**：JS 的 `(x*A + y*B + seed*C) >>> 0` 是先做 float64 乘法
## 再取模 —— seed 是 32 位无符号数，`seed * 1442695041` 能到 6.2e18，
## 早就超过 float64 的整数精度（2^53），所以 JS 那一步**本来就是有舍入误差的**。
## 若在 GDScript 里用 int64 精确相乘，反而和 JS 对不上（实测一堆噪声值全错）。
## 复刻精度误差是这里唯一正确的做法。
static func hash2(x: int, y: int, p_seed: int) -> float:
	var sum := float(x) * 374761393.0 + float(y) * 668265263.0 + float(p_seed) * 1442695041.0
	var h := to_u32(sum)
	h = GdMath.imul(h ^ (h >> 13), 1274126177)
	return float((h ^ (h >> 16)) & U32) / 4294967296.0


## JS `>>> 0` 的等价物：向零截断后取低 32 位（负数按二进制补码回绕，与 ToUint32 一致）
static func to_u32(v: float) -> int:
	return int(v) & U32


static func _fade(t: float) -> float:
	return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


class ValueNoise:
	var seed: int = 1

	func _init(p_seed = 1) -> void:
		if typeof(p_seed) == TYPE_STRING:
			seed = GdMath.hash_str(p_seed)
		else:
			var n := int(p_seed) & U32
			seed = n if n != 0 else 1

	## 可复现的 2D 值噪声，输出 [0,1]
	func at(x: float, y: float) -> float:
		var xi := int(floor(x))
		var yi := int(floor(y))
		var xf := x - float(xi)
		var yf := y - float(yi)
		var u := GdNoise._fade(xf)
		var v := GdNoise._fade(yf)
		var a := GdNoise.hash2(xi, yi, seed)
		var b := GdNoise.hash2(xi + 1, yi, seed)
		var c := GdNoise.hash2(xi, yi + 1, seed)
		var d := GdNoise.hash2(xi + 1, yi + 1, seed)
		return lerpf(lerpf(a, b, u), lerpf(c, d, u), v)

	## 分形叠加，输出约 [0,1]
	func fbm(x: float, y: float, octaves: int = 4, lacunarity: float = 2.0, gain: float = 0.5) -> float:
		var amp := 1.0
		var freq := 1.0
		var sum := 0.0
		var norm := 0.0
		for i in octaves:
			sum += amp * at(x * freq + float(i) * 37.7, y * freq - float(i) * 19.3)
			norm += amp
			amp *= gain
			freq *= lacunarity
		return sum / norm

	## 脊状噪声：山脉 / 峡谷
	func ridged(x: float, y: float, octaves: int = 4) -> float:
		var amp := 1.0
		var freq := 1.0
		var sum := 0.0
		var norm := 0.0
		for i in octaves:
			var n := 1.0 - absf(at(x * freq + float(i) * 11.1, y * freq + float(i) * 7.7) * 2.0 - 1.0)
			sum += amp * n * n
			norm += amp
			amp *= 0.5
			freq *= 2.0
		return sum / norm

	## 域扭曲：让地形更有机
	func warped(x: float, y: float, strength: float = 0.35, octaves: int = 4) -> float:
		var wx := fbm(x * 0.5 + 5.2, y * 0.5 + 1.3, 3) - 0.5
		var wy := fbm(x * 0.5 - 3.1, y * 0.5 + 9.7, 3) - 0.5
		return fbm(x + wx * strength * 10.0, y + wy * strength * 10.0, octaves)


## 细胞噪声：最近特征点距离，用于成簇分布（矿区、巢穴）
class CellNoise:
	var seed: int = 1
	var density: float = 8.0
	var _cache: Dictionary = {}

	func _init(p_seed = 1, p_density: float = 8.0) -> void:
		if typeof(p_seed) == TYPE_STRING:
			seed = GdMath.hash_str(p_seed)
		else:
			var n := int(p_seed) & U32
			seed = n if n != 0 else 1
		density = p_density

	func _points(cx: int, cy: int) -> Array:
		var key := cx * 100003 + cy
		if _cache.has(key):
			return _cache[key]
		# 每一项都要先掩到 32 位：JS 的 `cx * 73856093` 是浮点乘法，
		# 参与 `^` 时按 ToInt32 回绕，等价于各自 & 0xFFFFFFFF 再异或
		var sub := (seed ^ ((cx * 73856093) & U32) ^ ((cy * 19349663) & U32)) & U32
		var r := Rng.new(sub)
		var pts: Array = []
		var count := 1 + int(floor(r.next_f() * 2.0))
		for i in count:
			pts.append([float(cx) + r.next_f(), float(cy) + r.next_f()])
		_cache[key] = pts
		return pts

	## 返回 [最近距离(归一化 0..1), 特征点世界坐标 x, y]
	func at(x: float, y: float) -> Array:
		var gx := x / density
		var gy := y / density
		var cx := int(floor(gx))
		var cy := int(floor(gy))
		var best := 1.0e9
		var bx := 0.0
		var by := 0.0
		for oy in range(-1, 2):
			for ox in range(-1, 2):
				for p in _points(cx + ox, cy + oy):
					var dx: float = p[0] - gx
					var dy: float = p[1] - gy
					var d := dx * dx + dy * dy
					if d < best:
						best = d
						bx = float(p[0]) * density
						by = float(p[1]) * density
		return [minf(1.0, sqrt(best)), bx, by]
