## 武器数值与弹药结算 —— `player.js` 的 weaponStat / ammo 系列 + `weapons.js` 的换弹表。
##
## 四条武器科技线都**有硬上限**（`WEAPON_CAPS`），在读取时钳制，
## 这样「科技点满」也不会把数值顶到失控：
##   射程 +300% / 伤害 +300% / 射速 +200% / 弹道 3 条
##
## 弹药**永远是整数**：不足 1 发的零头记在 `ammo_frac` 里，攒够 1 发才真扣。
## （JS 版以前直接减 0.15，界面上会出现 159.7 这种数字，玩家问过。）
class_name WeaponMath

const CAPS := {
	"rangeMult": 2.0,
	"damage": 2.0,
	"attackSpeed": 1.0,
	"projectiles": 2.0,
}

## 换弹基础时间（秒）—— 与 data/weapons.js 的 RELOAD_BY_WEAPON 一致
const RELOAD_BY_WEAPON := {
	"pistol": 1.20, "smg": 1.85, "rifle": 1.55, "shotgun": 1.75, "breacher": 1.80,
	"railgun": 2.60, "nailgun": 1.40, "injector": 1.30, "sporeLauncher": 2.20, "flame": 1.70,
}
## 品质对换弹时间的影响
const RARITY_RELOAD := {
	"common": 1.00, "uncommon": 0.95, "rare": 0.90, "epic": 0.85, "relic": 0.78, "legendary": 0.85,
}


## 吃上限的属性值
static func weapon_stat(stats: StatSet, key: String) -> float:
	var raw := stats.stat(key)
	if not CAPS.has(key):
		return raw
	return GdMath.clampv(raw, 0.0, float(CAPS[key]))


static func weapon_range(stats: StatSet, weapon_def: Dictionary) -> float:
	return DataLoader.num(weapon_def, "range", 0.0) * (1.0 + weapon_stat(stats, "rangeMult"))


static func weapon_damage_mult(stats: StatSet, extra: float = 0.0) -> float:
	return 1.0 + weapon_stat(stats, "damage") + extra


static func weapon_cooldown(stats: StatSet, weapon_def: Dictionary) -> float:
	return DataLoader.num(weapon_def, "cd", 0.5) / (1.0 + weapon_stat(stats, "attackSpeed"))


## 同时发射的弹道条数（1 基础 + 科技加成，上限 3）
static func weapon_barrels(stats: StatSet) -> int:
	return 1 + int(round(weapon_stat(stats, "projectiles")))


## 某把武器 + 某品质的换弹时间（与 JS reloadTimeOf 同式：下限 0.5，两位小数）
static func reload_time_of(weapon_def: Dictionary, rarity: String = "common") -> float:
	if weapon_def.is_empty():
		return 1.6
	var base := DataLoader.num(weapon_def, "reloadTime", float(RELOAD_BY_WEAPON.get(String(weapon_def.get("id", "")), 1.6)))
	var mult := float(RARITY_RELOAD.get(rarity, 1.0))
	return maxf(0.5, round(base * mult * 100.0) / 100.0)


## 一发的弹药消耗
static func ammo_cost_of(stats: StatSet, weapon_def: Dictionary) -> float:
	var base := 1.0
	if weapon_def.has("ammoPerShot") and weapon_def["ammoPerShot"] != null:
		base = DataLoader.num(weapon_def, "ammoPerShot", 1.0)
	var mult := 1.0 + stats.stat("ammoCostMult")
	return maxf(0.0, base * mult)


## 能不能开这一枪（mounted = 挂在载具上，不耗玩家弹药）
static func can_spend_ammo(stats: StatSet, weapon_def: Dictionary, player: Dictionary, mounted: bool = false) -> bool:
	if mounted:
		return true
	var cost := ammo_cost_of(stats, weapon_def)
	if cost <= 0.0:
		return true
	return float(player.get("ammo", 0)) >= 1.0 or float(player.get("ammo_frac", 0.0)) + cost >= 1.0


## 扣弹药：整数永远干净，零头留在 ammo_frac 里
static func spend_ammo(stats: StatSet, weapon_def: Dictionary, player: Dictionary, mounted: bool = false, times: int = 1) -> void:
	if mounted:
		return
	var cost := ammo_cost_of(stats, weapon_def) * float(times)
	if cost <= 0.0:
		return
	var frac := float(player.get("ammo_frac", 0.0)) + cost
	var ammo := float(player.get("ammo", 0))
	while frac >= 1.0:
		frac -= 1.0
		ammo -= 1.0
	player["ammo_frac"] = frac
	player["ammo"] = maxf(0.0, round(ammo))
