## 数学与哈希工具 —— **必须与 JS 版逐位一致**。
##
## 为什么这么较真：世界生成、掉落、实验科技抽取全都建立在这些函数上。
## 只要哈希或随机数有一位不一样，同一个种子就会生成完全不同的地图，
## 现有存档里的世界也就对不上了。所以这里刻意复刻 JS 的 32 位语义
## （`Math.imul` / `>>> 0`），并且用 `tools/godot-verify.mjs` 做跨语言黄金对比。
##
## 关键点：GDScript 的 int 是 64 位有符号，`a * b` 可能溢出；
## 所以 32 位乘法一律走 `imul()`（拆成 16 位做，绝不丢精度）。
class_name GdMath

const U32 := 0xFFFFFFFF
const TAU_F := PI * 2.0


## 模拟 JS 的 `Math.imul(a, b) >>> 0`：低 32 位相乘，结果当无符号看。
## 拆成 16 位半字，避免 64 位溢出（两个 32 位数相乘能到 2^64）。
static func imul(a: int, b: int) -> int:
	var ua := a & U32
	var ub := b & U32
	var a_lo := ua & 0xFFFF
	var a_hi := (ua >> 16) & 0xFFFF
	var b_lo := ub & 0xFFFF
	var b_hi := (ub >> 16) & 0xFFFF
	var lo := a_lo * b_lo
	var mid := (a_hi * b_lo + a_lo * b_hi) & 0xFFFF
	return (lo + (mid << 16)) & U32


## FNV-1a 字符串哈希 —— 与 `src/core/math.js` 的 hashStr 完全一致。
## 注意 JS 用 charCodeAt（UTF-16 码元），GDScript 的 unicode_at 也是码点，
## 但中文种子会跨越 BMP 之外……实际种子都是 ASCII，这里按 UTF-16 码元近似。
static func hash_str(s: String) -> int:
	var h := 2166136261
	for i in s.length():
		h ^= s.unicode_at(i)
		h = imul(h, 16777619)
	return h & U32


static func clampf01(v: float) -> float:
	return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


static func clampv(v: float, lo: float, hi: float) -> float:
	return lo if v < lo else (hi if v > hi else v)


static func lerp_f(a: float, b: float, t: float) -> float:
	return a + (b - a) * t


static func dist2(ax: float, ay: float, bx: float, by: float) -> float:
	var dx := bx - ax
	var dy := by - ay
	return dx * dx + dy * dy


static func dist(ax: float, ay: float, bx: float, by: float) -> float:
	return sqrt(dist2(ax, ay, bx, by))


static func angle_to(ax: float, ay: float, bx: float, by: float) -> float:
	return atan2(by - ay, bx - ax)


## 归一到 (-PI, PI]
static func norm_angle(a: float) -> float:
	var r := a
	while r > PI:
		r -= TAU_F
	while r <= -PI:
		r += TAU_F
	return r


## 朝目标角度平滑旋转，限制每帧最大角速度（与 JS turnToward 一致）
static func turn_toward(cur: float, target: float, max_step: float) -> float:
	var d := norm_angle(target - cur)
	if absf(d) <= max_step:
		return target
	return cur + signf(d) * max_step


static func snap_to_grid(v: float, size: float) -> float:
	return floorf(v / size) * size + size / 2.0


## Variant → bool。GDScript 没有 `bool()` 构造器（写 `bool(x)` 会报
## "Nonexistent 'bool' constructor"），而 JSON 读进来的布尔/数字是 Variant，
## 到处写 `x == true` 又容易漏 —— 统一走这里。
static func truthy(v) -> bool:
	if v == null:
		return false
	if v is bool:
		return v
	if v is int:
		return v != 0
	if v is float:
		return v != 0.0
	if v is String:
		return v != ""
	return true