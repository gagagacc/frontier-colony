## 怪物创建 / 缩放 / 伤害结算 —— `runState.createEnemy` + `enemies.damage` 的移植。
##
## 数值必须与 JS 完全一致（黄金对比逐字段比对），因为「怪有多强」直接决定难度曲线：
##   缩放 = hp: 1+(tier-1)*0.42+P*0.38 · dmg: 1+(tier-1)*0.28+P*0.30
##          xp: 1+(tier-1)*0.5+P*0.45 · gold: 1+(tier-1)*0.55+P*0.5
## 护甲走**减伤百分比**（armor/(armor+42)），不是直接减数字 ——
## 否则高护甲单位会完全免疫。
class_name EnemyFactory

const TAU_F := PI * 2.0

## 全局自增 id（与 JS 的 nextId 同义，只用于区分实例）
static var _seq := 0


static func next_id() -> int:
	_seq += 1
	return _seq


## 与 JS `enemyScaleFor` 同式
static func scale_for(planet_index: int, tier: int, extra: float = 1.0) -> Dictionary:
	var p := float(planet_index)
	var t := 1.0 + (float(tier) - 1.0) * 0.42 + p * 0.38
	return {
		"hp": t * extra,
		"dmg": (1.0 + (float(tier) - 1.0) * 0.28 + p * 0.30) * extra,
		"xp": 1.0 + (float(tier) - 1.0) * 0.5 + p * 0.45,
		"gold": 1.0 + (float(tier) - 1.0) * 0.55 + p * 0.5,
	}


## 与 player.js 的 applyArmor 同式：护甲按减伤百分比
static func apply_armor(dmg: float, armor: float) -> float:
	if armor <= 0.0:
		return dmg
	var reduction := armor / (armor + 42.0)
	return dmg * (1.0 - reduction)


## 建一只怪。monster_def 来自 monsters.json，rng 用于与 JS 同序的初始抖动。
##
## 注意随机数消耗顺序：JS 的 createEnemy 依次取 attackCd、flankAngle、wobble 三次，
## 这里必须同样顺序、同样次数，否则同一场战斗的随机流会分叉。
static func create(rng: Rng, monster_def: Dictionary, x: float, y: float, opts: Dictionary = {}) -> Dictionary:
	if monster_def.is_empty():
		return {}
	var tier := int(opts.get("tier", 1))
	var scale: Dictionary = opts.get("scale", { "hp": 1.0, "dmg": 1.0, "xp": 1.0, "gold": 1.0 })
	var elite_mult := 1.6 if GdMath.truthy(opts.get("elite", false)) else 1.0
	var hp := float(monster_def.get("hp", 10.0)) * float(scale["hp"]) * elite_mult * float(opts.get("hpMult", 1.0))
	var def_scale := float(monster_def.get("scale", 1.0))
	var def_elite := GdMath.truthy(monster_def.get("elite", false))

	var e := {
		"id": next_id(),
		"kind": "enemy",
		"type": String(monster_def.get("id", "")),
		"def": monster_def,
		"x": x, "y": y,
		"r": float(monster_def.get("r", 12.0)) * def_scale,
		"hp": float(opts.get("hp", hp)),
		"hpMax": float(opts.get("hp", hp)),
		"dmg": float(monster_def.get("dmg", 5.0)) * float(scale["dmg"]) * float(opts.get("dmgMult", 1.0)),
		"speed": float(monster_def.get("speed", 60.0)) * float(opts.get("speedMult", 1.0)),
		"armor": float(monster_def.get("armor", 0.0)) + float(opts.get("armorBonus", 0.0)),
		"angle": 0.0,
		"vx": 0.0, "vy": 0.0,
		"attackCd": rng.range_f(0.0, 0.6),
		"target": null,
		"targetKind": "",
		"targetPlayer": false,
		"state": "seek",
		"stateTimer": 0.0,
		"stun": 0.0,
		"marks": 0.0,
		"markTimer": 0.0,
		"tier": tier,
		"elite": def_elite or GdMath.truthy(opts.get("elite", false)),
		"boss": GdMath.truthy(opts.get("boss", false)),
		"fromNest": opts.get("fromNest", null),
		"waveId": opts.get("waveId", null),
		"xpValue": float(monster_def.get("xp", 5.0)) * float(scale["xp"]) * (2.2 if def_elite else 1.0),
		"goldValue": float(monster_def.get("gold", 3.0)) * float(scale["gold"]) * (2.5 if def_elite else 1.0),
		"dead": false,
		"summoned": GdMath.truthy(opts.get("summoned", false)),
		"abilityCd": float(monster_def.get("ability", {}).get("cd", 0.0)) if monster_def.has("ability") else 0.0,
		"phaseIndex": 0,
		"flankAngle": rng.range_f(-1.0, 1.0) * float(monster_def.get("flank", 0.4)),
		"wobble": rng.range_f(0.0, TAU_F),
		"hitFlash": 0.0,
		"scale": scale,
		"spawnAnim": 0.45,
		"homeX": x, "homeY": y,
		"role": String(opts.get("role", "")),
	}
	e["angle"] = GdMath.angle_to(x, y, x + 1.0, y)   # 朝向由调用方按目标覆盖
	return e


## 伤害入口（与 JS enemies.damage 同式）
## 返回实际造成的伤害；hp <= 0 时把 dead 置位（击杀结算由调用方做）
static func damage(e: Dictionary, amount: float, ignore_armor: bool = false) -> float:
	if e.is_empty() or GdMath.truthy(e.get("dead", false)):
		return 0.0
	var dmg := amount
	if not ignore_armor:
		dmg = apply_armor(dmg, float(e.get("armor", 0.0)))
	if float(e.get("marks", 0.0)) > 0.0:
		dmg *= 1.0 + float(e["marks"]) * 0.12
	dmg = maxf(1.0, dmg)
	e["hp"] = float(e["hp"]) - dmg
	e["hitFlash"] = 1.0
	if float(e["hp"]) <= 0.0:
		e["dead"] = true
	return dmg
