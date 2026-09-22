## 维修 / 重建 —— `runState.repairStructureAt` + `nearestRepairable` + 基地重建的移植。
##
## 规则（与 JS 逐项对应）：
##   - **维修速率 30/s × (1+repairMult)**，**花费 0.28 金属/点** ×(1+repairCostMult)×(1+buildCostMult)；
##   - 金属不够就修不动（返回 false，UI 会显示进度为 0）；
##   - 「最该修的目标」= 范围内**越近、血越少越优先**：`score = 距离 + 血量比×40`；
##   - 基地被毁后按 `BASE.rebuildTime = 12s` 重建（每次点击推进 `rebuildPerTap = 0.55`）。
##
## 为什么值得单独测：这几条都是「玩家在战场上按 E」时才会走到，
## 平时没人碰；而一旦花费或速率写错，表现只是「修得慢一点」，很难察觉。
class_name Repair

## 修一个目标；返回「这一次真的修了吗」
static func repair_at(target: Dictionary, stats: StatSet, resources: Dictionary, dt: float) -> bool:
	if target.is_empty():
		return false
	var max_hp := float(target.get("maxHp", 0.0))
	if max_hp <= 0.0 or float(target.get("hp", 0.0)) >= max_hp:
		return false
	var rate := 30.0 * (1.0 + stats.stat("repairMult"))
	var cost_per_hp := 0.28 * (1.0 + stats.stat("repairCostMult")) * (1.0 + stats.stat("buildCostMult"))
	var heal := minf(rate * dt, max_hp - float(target["hp"]))
	var cost := heal * cost_per_hp
	if float(resources.get("metal", 0.0)) < cost:
		return false
	resources["metal"] = float(resources.get("metal", 0.0)) - cost
	target["hp"] = minf(max_hp, float(target["hp"]) + heal)
	target["repairFlash"] = 1.0      # 渲染层画一圈绿光，让「正在修」看得见
	return true


## 附近最该修的目标：越近、越破的优先（`score = 距离 + 血量比×40`）
static func nearest_repairable(targets: Array, x: float, y: float, range_px: float = 76.0) -> Variant:
	var best: Variant = null
	var best_score := INF
	for t in targets:
		if GdMath.truthy(t.get("destroyed", false)):
			continue
		var max_hp := float(t.get("maxHp", 0.0))
		if max_hp <= 0.0 or float(t.get("hp", 0.0)) >= max_hp:
			continue
		var d := GdMath.dist(x, y, float(t["x"]), float(t["y"]))
		if d > range_px:
			continue
		var score := d + (float(t["hp"]) / max_hp) * 40.0
		if score < best_score:
			best_score = score
			best = { "target": t, "d": d, "maxHp": max_hp }
	return best


## 基地重建：每次点击推进 rebuildPerTap，走满 rebuildTime 就恢复
static func rebuild_step(base: Dictionary, dt: float, tapped: bool,
	rebuild_time: float = 12.0, per_tap: float = 0.55) -> bool:
	if not GdMath.truthy(base.get("destroyed", false)):
		return false
	var progress := float(base.get("repairProgress", 0.0))
	progress += (dt / maxf(0.1, rebuild_time)) + (per_tap if tapped else 0.0)
	if progress >= 1.0:
		base["repairProgress"] = 0.0
		base["destroyed"] = false
		base["hp"] = float(base.get("maxHp", 2600.0))
		return true
	base["repairProgress"] = progress
	return false


## 基地耐久维修（与建筑同式，但速率与花费来自 BASE）
static func repair_base(base: Dictionary, stats: StatSet, resources: Dictionary, dt: float,
	rate_base: float = 34.0, cost_per_hp: float = 0.22) -> bool:
	if GdMath.truthy(base.get("destroyed", false)):
		return false
	var max_hp := float(base.get("maxHp", 0.0))
	if max_hp <= 0.0 or float(base.get("hp", 0.0)) >= max_hp:
		return false
	var rate := rate_base * (1.0 + stats.stat("repairMult"))
	var cph := cost_per_hp * (1.0 + stats.stat("repairCostMult")) * (1.0 + stats.stat("buildCostMult"))
	var heal := minf(rate * dt, max_hp - float(base["hp"]))
	var cost := heal * cph
	if float(resources.get("metal", 0.0)) < cost:
		return false
	resources["metal"] = float(resources.get("metal", 0.0)) - cost
	base["hp"] = minf(max_hp, float(base["hp"]) + heal)
	return true


## 拆掉一座塔/建筑能退回多少（JS 的拆除是「半价退回」）
static func refund_for(cost: Dictionary, ratio: float = 0.5) -> Dictionary:
	var out: Dictionary = {}
	for k in cost.keys():
		var v := float(cost[k]) * ratio
		if v >= 1.0:
			out[String(k)] = int(floor(v))
	return out
