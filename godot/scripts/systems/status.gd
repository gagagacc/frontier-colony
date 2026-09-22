class_name Status

## 状态效果与伤害持续 —— `src/systems/enemies.js` 的 `tickStatuses` / `speedOf` 移植。
##
## 三条规则都照搬 JS：
##   - 燃烧 / 中毒：每秒伤害 × 层数，逐帧结算；持续时间到就清掉；
##   - 减速：`speedOf` 里按 `1 - amount×层数` 打折，到时间清掉；
##   - 标记（marks）：每层让受到的伤害 +12%（见 EnemyFactory.damage），超时清零。
static func apply_slow(e: Dictionary, amount: float, dur: float, stacks: int = 1) -> void:
	var cur: Dictionary = e.get("slow", {})
	var keep := float(cur.get("amount", 0.0)) if not cur.is_empty() else 0.0
	e["slow"] = { "amount": maxf(keep, amount), "remain": maxf(float(cur.get("remain", 0.0)), dur), "stacks": stacks }


static func apply_burn(e: Dictionary, dps: float, dur: float, stacks: int = 1) -> void:
	var cur: Dictionary = e.get("burn", {})
	var cur_dps := float(cur.get("dps", 0.0)) if not cur.is_empty() else 0.0
	var cur_st := int(cur.get("stacks", 0)) if not cur.is_empty() else 0
	e["burn"] = {
		"dps": maxf(cur_dps, dps),
		"remain": maxf(float(cur.get("remain", 0.0)), dur),
		"stacks": maxi(cur_st, stacks),
	}


static func apply_poison(e: Dictionary, dps: float, dur: float, stacks: int = 1) -> void:
	var cur: Dictionary = e.get("poison", {})
	e["poison"] = {
		"dps": float(cur.get("dps", 0.0)) if cur.is_empty() else maxf(float(cur["dps"]), dps),
		"remain": float(cur.get("remain", 0.0)) if cur.is_empty() else maxf(float(cur["remain"]), dur),
		"stacks": stacks,
	}


## 每帧推进状态；返回这一帧由状态造成的总伤害（护甲不参与，与 JS 一致）
static func tick(e: Dictionary, dt: float) -> float:
	if e.is_empty() or GdMath.truthy(e.get("dead", false)):
		return 0.0
	var total := 0.0
	var burn = e.get("burn")
	if burn is Dictionary and not (burn as Dictionary).is_empty():
		burn["remain"] = float(burn["remain"]) - dt
		var dmg := float(burn["dps"]) * float(burn.get("stacks", 1)) * dt
		e["hp"] = float(e["hp"]) - dmg
		total += dmg
		if float(burn["remain"]) <= 0.0:
			e["burn"] = null
		if float(e["hp"]) <= 0.0:
			e["dead"] = true
			return total
	var poison = e.get("poison")
	if poison is Dictionary and not (poison as Dictionary).is_empty():
		poison["remain"] = float(poison["remain"]) - dt
		var dmg2 := float(poison["dps"]) * float(poison.get("stacks", 1)) * dt
		e["hp"] = float(e["hp"]) - dmg2
		total += dmg2
		if float(poison["remain"]) <= 0.0:
			e["poison"] = null
		if float(e["hp"]) <= 0.0:
			e["dead"] = true
			return total
	var bleed = e.get("bleed")
	if bleed is Dictionary and not (bleed as Dictionary).is_empty():
		bleed["remain"] = float(bleed["remain"]) - dt
		var dmg3 := float(bleed["dps"]) * dt
		e["hp"] = float(e["hp"]) - dmg3
		total += dmg3
		if float(bleed["remain"]) <= 0.0:
			e["bleed"] = null
		if float(e["hp"]) <= 0.0:
			e["dead"] = true
			return total
	var slow = e.get("slow")
	if slow is Dictionary and not (slow as Dictionary).is_empty():
		slow["remain"] = float(slow["remain"]) - dt
		if float(slow["remain"]) <= 0.0:
			e["slow"] = null
	if float(e.get("marks", 0.0)) > 0.0:
		e["markTimer"] = float(e.get("markTimer", 0.0)) - dt
		if float(e["markTimer"]) <= 0.0:
			e["marks"] = 0.0
	return total


## 移动速度（含减速、遁地、地形）—— 与 JS `speedOf` 同式
static func speed_of(e: Dictionary, world) -> float:
	var s := float(e.get("speed", 60.0))
	var slow = e.get("slow")
	if slow is Dictionary and not (slow as Dictionary).is_empty():
		s *= 1.0 - GdMath.clampf01(float(slow.get("amount", 0.0)) * float(slow.get("stacks", 1)))
	if GdMath.truthy(e.get("burrowed", false)):
		s *= 1.5
	if world != null:
		s *= 0.9 + world.speed_at_px(float(e["x"]), float(e["y"])) * 0.12
	return s
