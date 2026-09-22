## 属性聚合引擎 —— `src/systems/stats.js` 的移植。
##
## 所有成长来源（角色被动 / 主科技树 / 实验科技 / 装备 / 词缀 / 基因 / 临时 buff）
## 都产出同一种「修正」，由这里统一算成最终属性：
##   - 数值键：加法叠加
##   - 对象键（机制）：取「最强」的一份，避免数值爆炸
##   - 开关键：后者覆盖
## 数值必须与 JS 完全一致 —— 黄金对比会拿同一批科技/实验等级算出全部 123 个键。
class_name StatSet

## 全部数值键与默认值（顺序与 JS 的 DEFAULT_STATS 一致，键名也一样）
const DEFAULT_KEYS := [
	"hpMax", "hpRegen", "armor", "shieldMax", "shieldRegen", "speedMult", "dodgeCdMult",
	"staminaMax", "staminaRegen", "damage", "attackSpeed", "projectiles", "critChance",
	"critMult", "rangeMult", "pierce", "knockbackMult", "lifeSteal", "meleeMult",
	"towerDamage", "towerAttackSpeed", "towerRange", "towerCap", "towerSlotRadius",
	"eliteDamage", "bossDamage", "nightDamage", "dotMult", "poisonOnHit", "thorn",
	"goldMult", "xpMult", "matMult", "luck", "lootQuality", "passiveGold", "goldInterest",
	"carryMult", "cargoBonus", "storageCap", "buildSpeed", "buildCostMult", "mineSpeed",
	"mineYield", "upgradeDiscount", "beaconRadiusMult", "beaconIntensityMult",
	"beaconFuelMult", "beaconFuelRegen", "powerOutput", "popCap", "popGrowthMult",
	"workerEfficiency", "jobSlots", "repairMult", "repairCostMult", "autoRepairBase",
	"autoRepair", "baseHeal", "structureHpMult", "structureArmor", "airDropSpeed",
	"airDropAuto", "vehicleSpeedMult", "vehicleHpMult", "vehicleSlots", "vehicleTurretCap",
	"ramMult", "pinResist", "fuelMult", "fuelRegen", "terrainIgnore", "vehicleWeaponDamage",
	"hazardResist", "coldResist", "heatResist", "acidResist", "sporeResist",
	"foodEfficiency", "healPower", "regenPct", "nightVision", "sightBonus", "revealRadius",
	"mapReveal", "resourceSense", "dnaMult", "bioPointGain", "tameSlots", "tameSpeed",
	"tamePower", "tameElite", "geneSlots", "genePower", "monsterFriendly", "tradeDiscount",
	"sellBonus", "supplyDropRate", "supplyBonus", "ammoCostMult", "ammoCraft", "smeltOnKill",
	"autoCollect", "autoCollectRadius", "autoDeposit", "selfSufficient",
	"deathPenaltyImmunity", "respawnAtBase", "relicChance", "eliteSpawnMult", "salvageMult",
	"beaconCoreFind", "experimentRefreshDiscount", "rebuildDiscount", "ignoreSlowResist",
	"manualDamageMult", "beaconIntensity", "rageBonus", "lowHpArmor", "killFrenzy",
	"killFrenzySpeed", "collisionHeal", "hiveGuard",
]

## 机制类键（对象）—— 取最强的一份
const MECHANIC_KEYS := [
	"towerExplode", "towerSlow", "towerBurn", "towerChain", "towerOvercharge",
	"towerExplodeOnDeath", "lastStand", "vengeance", "baseShield", "manualSplash",
	"dodgeDamage", "execute", "counterWave", "focusFire", "buildCostMult",
]

var base: Dictionary = {}
var flat: Dictionary = {}
var buffs: Array = []              # [{ mods, remain, id }]
var mechanics: Dictionary = {}
var _cache = null
var enabled := true


func _init(p_base: Dictionary = {}) -> void:
	for k in DEFAULT_KEYS:
		base[k] = 0
	for k in p_base.keys():
		base[k] = p_base[k]
	# 传进来的基础值直接就是初始 flat（JS 里踩过：只写进 base 会让角色基础属性全是 0）
	flat = base.duplicate(true)


static func is_plain_object(v) -> bool:
	return v is Dictionary


## 合并一份修正到累积器（与 JS fold 同义）
static func fold(acc: Dictionary, src: Dictionary) -> Dictionary:
	if src.is_empty():
		return acc
	for key in src.keys():
		var val = src[key]
		if val == null:
			continue
		if MECHANIC_KEYS.has(key) or is_plain_object(val):
			if acc.has(key) and acc[key] != null:
				acc[key] = stronger_mechanic(acc[key], val)
			else:
				acc[key] = val
		elif val is float or val is int:
			acc[key] = float(acc.get(key, 0.0)) + float(val)
		else:
			acc[key] = val          # 布尔/字符串：后者覆盖
	return acc


## 比较两个机制对象，"强"的判据按字段尝试（与 JS strongerMechanic 同式）
static func stronger_mechanic(a, b) -> Variant:
	return b if _mechanic_score(b) > _mechanic_score(a) else a


static func _mechanic_score(o) -> float:
	if not (o is Dictionary):
		return 0.0
	return float(o.get("mult", 0.0)) * 100.0 + float(o.get("dmg", 0.0)) * 10.0 \
		+ float(o.get("dmgMult", 0.0)) * 100.0 + float(o.get("amount", 0.0)) \
		+ float(o.get("dps", 0.0)) * 5.0 + float(o.get("chains", 0.0)) * 20.0 \
		+ float(o.get("radius", 0.0)) * 0.2


func add(mods) -> StatSet:
	if mods == null or (mods is Dictionary and mods.is_empty()):
		return self
	var d: Dictionary = mods
	fold(flat, d)
	for k in MECHANIC_KEYS:
		if d.has(k):
			mechanics[k] = flat.get(k)
	_cache = null
	return self


func remove(mods) -> StatSet:
	if mods == null:
		return self
	var d: Dictionary = mods
	for key in d.keys():
		var val = d[key]
		if (val is float or val is int) and (flat.get(key) is float or flat.get(key) is int):
			flat[key] = float(flat[key]) - float(val)
	_cache = null
	return self


func add_buff(mods, duration: float, id = null) -> void:
	if mods == null:
		return
	if id != null:
		var kept: Array = []
		for b in buffs:
			if b["id"] != id:
				kept.append(b)
		buffs = kept
	buffs.append({ "mods": mods, "remain": duration, "id": id })
	_cache = null


func remove_buff(id) -> void:
	var before := buffs.size()
	var kept: Array = []
	for b in buffs:
		if b["id"] != id:
			kept.append(b)
	buffs = kept
	if buffs.size() != before:
		_cache = null


func has_buff(id) -> bool:
	for b in buffs:
		if b["id"] == id:
			return true
	return false


func update(dt: float) -> void:
	if buffs.is_empty():
		return
	var changed := false
	for b in buffs:
		b["remain"] = float(b["remain"]) - dt
		if float(b["remain"]) <= 0.0:
			changed = true
	if changed:
		var kept: Array = []
		for b in buffs:
			if float(b["remain"]) > 0.0:
				kept.append(b)
		buffs = kept
		_cache = null


## 取最终属性（含 buff）。
## 注意：JS 里这个方法叫 get()，但 GDScript 的 Object 已经有 get(name)，
## 同名会覆盖原生方法（引擎直接报错），所以改名 stat()。
func stat(key: String) -> float:
	if _cache == null:
		var total := flat.duplicate(true)
		for b in buffs:
			fold(total, b["mods"])
		_cache = total
	var v = _cache.get(key, 0)
	return float(v) if (v is float or v is int) else 0.0


## 某个键的原始值（可能是机制对象 / 字符串 / 布尔）
func stat_raw(key: String) -> Variant:
	if _cache == null:
		var _warm := stat("__warm")
	var v = _cache.get(key)
	return v


func mechanic_of(key: String) -> Variant:
	var v = mechanics.get(key)
	if v == null:
		v = stat_raw(key)
	return v


func all_stats() -> Dictionary:
	if _cache == null:
		var _warm := stat("__warm")
	return _cache


func clear_buffs() -> void:
	buffs.clear()
	_cache = null


func reset() -> void:
	flat = base.duplicate(true)
	mechanics.clear()
	buffs.clear()
	_cache = null


# =========================================================
#  effects → 修正（foldEffects）
# =========================================================

## 把一堆效果对象折算成 { stats, unlocks }
## unlocks 里是 Set 语义的数组（towers/structures/features/meleeModules）+ 几个计数
static func fold_effects(effects_list: Array) -> Dictionary:
	var stats: Dictionary = {}
	var unlocks := {
		"towers": [], "structures": [], "features": [], "meleeModules": [],
		"bioPoints": 0, "beaconLevels": 0, "beaconCore": 0,
	}
	for eff in effects_list:
		if not (eff is Dictionary):
			continue
		for key in eff.keys():
			var val = eff[key]
			match key:
				"unlockTower":
					_push_unique(unlocks["towers"], val)
				"unlockStructure", "unlockStructure2":
					_push_unique(unlocks["structures"], val)
				"beaconLevel":
					unlocks["beaconLevels"] += int(val)
				"beaconCore":
					unlocks["beaconCore"] += int(val)
				"secondBase", "nextPlanet", "portableBeacon", "autoCollect", "airDropAuto", \
				"planetAdapt", "geneTree", "vehicleBeacon", "vehicleAsTurret", \
				"exclusiveBuildings", "exclusiveWeapons", "ejectOnDestroy", "stealth", "burrow":
					_push_unique(unlocks["features"], _feature_name(key))
				"vehicleUnlock":
					_push_unique(unlocks["features"], "vehicle")
				"tameEnabled":
					_push_unique(unlocks["features"], "tame")
				"vehicleMelee":
					_push_unique(unlocks["meleeModules"], val)
				"vehicleTurretCap":
					stats["vehicleTurretCap"] = maxf(float(stats.get("vehicleTurretCap", 0.0)), float(val))
				"hiveGuard":
					stats["hiveGuard"] = float(stats.get("hiveGuard", 0.0)) + float(val)
				"packDamage":
					stats["packDamage"] = float(stats.get("packDamage", 0.0)) + float(val)
				"phaseShield":
					stats["phaseShield"] = float(stats.get("phaseShield", 0.0)) + float(val)
				"thornAcid":
					stats["thornAcid"] = float(stats.get("thornAcid", 0.0)) + float(val)
				_:
					if is_plain_object(val):
						if stats.has(key):
							stats[key] = stronger_mechanic(stats[key], val)
						else:
							stats[key] = val
					elif val is float or val is int:
						stats[key] = float(stats.get(key, 0.0)) + float(val)
	return { "stats": stats, "unlocks": unlocks }


## JS 里那几个「开关型」key 映射到 features 集合时的名字（除了 vehicle/tame 是特例）
static func _feature_name(key: String) -> String:
	return key


static func _push_unique(arr: Array, v) -> void:
	if not arr.has(v):
		arr.append(v)


# =========================================================
#  等级缩放（runState.scaleEffect 的移植）
# =========================================================

const MULT_KEYS := ["damage", "attackSpeed", "speedMult", "goldMult", "xpMult", "matMult",
	"towerDamage", "towerAttackSpeed", "critChance", "critMult", "hpMax", "armor"]

static func scale_effect(effect: Dictionary, level: int, _kind: String = "stat") -> Dictionary:
	if level <= 1:
		return effect
	var out: Dictionary = {}
	for k in effect.keys():
		var v = effect[k]
		if v is float or v is int:
			out[k] = float(v) * float(level)
		elif is_plain_object(v):
			out[k] = scale_mechanic(v, level)
		else:
			out[k] = v
	return out


static func scale_mechanic(obj: Dictionary, level: int) -> Dictionary:
	var out := obj.duplicate(true)
	for k in ["mult", "dmg", "dps", "amount", "radius", "chains", "regen"]:
		if out.has(k) and (out[k] is float or out[k] is int):
			# 范围/连锁按较小斜率成长，避免机制爆炸
			var slope := 0.12 if (k == "radius" or k == "chains") else 0.55
			out[k] = float(out[k]) * (1.0 + slope * float(level - 1))
	return out
