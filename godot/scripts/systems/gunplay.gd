## 射击几何 —— `player.fireWeapon` 的开火部分单独抽出来（手感回归的第二刀）。
##
## 为什么单独一个文件：开火这段是「数值对但手感不同」的高发区，
## 而且它**必须在玩家和防御塔之间共用**，不然两边会慢慢长歪。
## 抽成纯函数之后就能逐项断言：弹道偏移、弹丸数、散布范围、枪口位置、
## 弹丸半径/寿命/穿透、以及弹药按弹道条数一起扣。
##
## 与 JS 对照的几条关键规则：
##   - 弹道条数 = 1 + round(projectiles)，**最多 3 条**（WEAPON_CAPS）；
##   - 多弹道左右对称铺开，**步长 0.075 弧度**，中间那条永远对准准星；
##   - 散布 `def.spread || 0`（**默认 0**，不是 0.05）；
##   - 每颗弹丸的角度 = 基准角 + 弹道偏移 + `rng.range(-spread, spread)`；
##   - 枪口在 `18px` 处（不是 玩家半径+6）；
##   - 半径：`subtype == 'gun'` → 4，否则 6；
##   - 寿命 = `射程 / 速度 × 1.15`；
##   - 穿透 = `def.pierce + weaponStat('pierce')`（**武器自己的穿透也要算**）。
class_name Gunplay

const BARREL_STEP := 0.075
const MUZZLE_DIST := 18.0
const LIFE_FACTOR := 1.15
const MAX_BARRELS := 3


## 生成一次开火的「射击计划」：[{ angle, x, y, speed, damage, r, life, pierce, color }]
##
## `rng` 传 null 时散布按 0 处理（黄金对比就是这么比的：把随机性拿掉，
## 只剩结构，才能逐项对照；随机部分另有 `spread_range()` 断言覆盖范围）。
static func plan_shot(def: Dictionary, stats: StatSet, angle: float, px: float, py: float,
	rng: Rng = null) -> Array:
	var barrels := barrels_for(stats)
	var pellets := maxi(1, DataLoader.int_of(def, "pellets", 1))
	var spread := DataLoader.num(def, "spread", 0.0)     # JS 是 `def.spread || 0`：默认 0
	var speed := DataLoader.num_or(def, "speed", 800.0)
	var dmg := DataLoader.num_or(def, "damage", 10.0) * WeaponMath.weapon_damage_mult(stats)
	var range_px := WeaponMath.weapon_range(stats, def)
	var subtype := DataLoader.str_of(def, "subtype", "")
	var pierce := DataLoader.int_of(def, "pierce", 0) + int(stats.stat("pierce"))
	var color := Color(DataLoader.str_of(def, "color", "#ffd98a"))
	var out: Array = []
	var barrel_step := BARREL_STEP if barrels > 1 else 0.0
	for b in barrels:
		var barrel_offset := (float(b) - (float(barrels) - 1.0) / 2.0) * barrel_step
		for i in pellets:
			var jitter := 0.0
			if rng != null and spread > 0.0:
				jitter = rng.range_f(-spread, spread)
			var a := angle + barrel_offset + jitter
			out.append({
				"angle": a,
				"x": px + cos(a) * MUZZLE_DIST,
				"y": py + sin(a) * MUZZLE_DIST,
				"speed": speed,
				"damage": dmg,
				"r": 4.0 if subtype == "gun" else 6.0,
				"life": (range_px / maxf(1.0, speed)) * LIFE_FACTOR,
				"pierce": pierce,
				"color": color,
			})
	return out


## 弹道条数（与 JS `1 + Math.round(weaponStat('projectiles'))` 同式，并封顶 3）
static func barrels_for(stats: StatSet) -> int:
	return mini(MAX_BARRELS, 1 + int(round(stats.stat("projectiles"))))


## 每开一枪要扣多少发弹药（JS：`spendAmmo(def, false, barrels)` —— 按弹道条数扣）
static func ammo_per_shot(def: Dictionary, stats: StatSet) -> int:
	return int(WeaponMath.ammo_cost_of(stats, def)) * barrels_for(stats)


## 散布范围（拿掉随机性之后，这个区间本身也要对）
static func spread_range(def: Dictionary) -> Vector2:
	var s := DataLoader.num(def, "spread", 0.0)
	return Vector2(-s, s)


## 多弹道的偏移序列（黄金对比直接比这个数组）
static func barrel_offsets(stats: StatSet) -> Array:
	var barrels := barrels_for(stats)
	var step := BARREL_STEP if barrels > 1 else 0.0
	var out: Array = []
	for b in barrels:
		out.append((float(b) - (float(barrels) - 1.0) / 2.0) * step)
	return out
