## 城镇系统 —— `src/systems/town.js` 的移植（阶段 10 收尾）。
##
## 三块规则（都是玩家反馈打磨出来的）：
##   1. **人口**：每 6 秒结算一次增长，断粮 20 秒掉 1 人；食物储备 > 人口×4 时增长 ×1.35；
##   2. **解锁是累积的**：`isUnlocked` 看的是「**达到过**的城镇等级里有没有解锁它」，
##      而不是只看当前这一档 —— 否则升到「拓荒城市」之后，工坊会突然造不了
##      （JS 版原来的写法就是这个 bug，注释里写明了）；
##   3. **生产**：每名工人每秒按 `def.produce` 产出，效率受 `workerEfficiency` 影响。
class_name Town

const POP_GROWTH_INTERVAL := 6.0
const FOOD_PER_POP := 0.02
const STARVE_SECONDS := 20.0

## 靠科技解锁的建筑（与 town.js 的 techUnlocks 一致）
const TECH_UNLOCKS := { "farm": "t_farm", "clinic": "t_clinic", "lab": "t_lab", "market": "t_trade" }
## 永远可建的最初级建筑
const ALWAYS_UNLOCKED := ["hab", "water"]

var stats: StatSet
var population := 0
var town_tier := 0
var buildings: Array = []
var resources: Dictionary = {}
var growth_timer := POP_GROWTH_INTERVAL   # JS 构造时就是 6（不是 0）
var pop_accum := 0.0
var starving := 0.0
var unlocked_tech: Dictionary = {}
var planet_index := 0

var _tiers: Array = []
var _defs: Dictionary = {}


func _init(p_stats: StatSet, p_unlocked_tech: Dictionary = {}) -> void:
	stats = p_stats
	unlocked_tech = p_unlocked_tech
	var mod: Dictionary = DataLoader.new().module("planets")
	_tiers = mod.get("POP_TIERS", [])
	_defs = mod.get("TOWN_BUILDING_DEF", {})


func def_of(type: String) -> Dictionary:
	return _defs.get(type, {})


func tier_defs() -> Array:
	return _tiers


## 当前人口对应的城镇档位（POP_TIERS 里最后一个 pop ≤ 人口）
func tier_for(pop: int) -> Dictionary:
	var out: Dictionary = _tiers[0] if not _tiers.is_empty() else {}
	for t in _tiers:
		if pop >= int(t["pop"]):
			out = t
		else:
			break
	return out


func tier_index_for(pop: int) -> int:
	var idx := 0
	for i in _tiers.size():
		if pop >= int(_tiers[i]["pop"]):
			idx = i
		else:
			break
	return idx


## 人口上限（与 town.js 的 get popCap 同式）：
## **4 + 科技加成 + 居住建筑之和**；基地全毁时压到 2（没地方住了）。
func pop_cap() -> int:
	var cap := 4 + int(round(stats.stat("popCap")))
	for b in buildings:
		var d := def_of(String(b["type"]))
		if d.has("popCap"):
			cap += DataLoader.int_of(d, "popCap", 0)
	if not bases_alive():
		cap = mini(cap, 2)
	return cap


## 是否还有完好的基地（JS 里是 ases.some(b => !b.destroyed)）
var bases: Array = []


func bases_alive() -> bool:
	if bases.is_empty():
		return true   # 没登记基地时不做限制（测试/早期状态）
	for b in bases:
		if not GdMath.truthy(b.get("destroyed", false)):
			return true
	return false


func assigned_pop() -> int:
	var n := 0
	for b in buildings:
		n += int(b.get("workers", 0))
	return n


func idle_pop() -> int:
	return maxi(0, population - assigned_pop())


## 每帧：食物消耗 + 断粮掉人 + 定时增长
func update_population(dt: float) -> Dictionary:
	var out := { "grew": 0, "starved": 0 }
	var need := float(population) * FOOD_PER_POP * (1.0 - GdMath.clampf01(stats.stat("foodEfficiency")) * 0.5)
	if need > 0.0:
		var food := float(resources.get("food", 0.0))
		if food >= need * dt:
			resources["food"] = food - need * dt
		else:
			resources["food"] = 0.0
			starving += dt
			if starving > STARVE_SECONDS:
				starving = 0.0
				if population > 0:
					population -= 1
					out["starved"] = 1
			return out

	growth_timer -= dt
	if growth_timer > 0.0:
		return out
	growth_timer = POP_GROWTH_INTERVAL
	var cap := pop_cap()
	if population >= cap:
		return out
	# 增长率：科技 + 士气 + 食物储备
	var rate := 0.06 + stats.stat("popGrowthMult") * 0.09
	for b in buildings:
		var d := def_of(String(b["type"]))
		if d.has("morale"):
			rate += DataLoader.num_or(d, "morale", 0.0) * 0.04
	if float(resources.get("food", 0.0)) > float(population) * 4.0:
		rate *= 1.35
	rate *= 1.0 + float(planet_index) * 0.08
	pop_accum += rate
	if pop_accum >= 1.0:
		var gain := int(floor(pop_accum))
		pop_accum -= float(gain)
		population = mini(cap, population + gain)
		out["grew"] = gain
	return out


## 城镇档位变化（升级不会掉档；解锁是累积的）
func update_tier() -> Dictionary:
	var idx := tier_index_for(population)
	var out := { "changed": false, "rising": false, "index": idx }
	if idx != town_tier:
		out["changed"] = true
		out["rising"] = idx > town_tier
		town_tier = idx
	return out


## 建筑是否解锁 —— **累积判断**：达到过的每一档的 unlock 都算
func is_unlocked(type: String) -> bool:
	for i in _tiers.size():
		var t: Dictionary = _tiers[i]
		if population < int(t["pop"]):
			break
		if (t.get("unlock", []) as Array).has(type):
			return true
	# 部分建筑靠科技解锁
	if TECH_UNLOCKS.has(type) and unlocked_tech.has(String(TECH_UNLOCKS[type])):
		return true
	return ALWAYS_UNLOCKED.has(type)


## 放下一座建筑（位置由调用方校验；这里只管钱与登记）
func place_building(type: String, x: float, y: float) -> Dictionary:
	var def := def_of(type)
	if def.is_empty() or not is_unlocked(type):
		return {}
	if not can_afford(def.get("cost", {})):
		return {}
	pay(def.get("cost", {}))
	var b := {
		"id": "tb%d_%d" % [buildings.size() + 1, int(Time.get_ticks_msec())],
		"type": type, "x": x, "y": y, "workers": 0, "hp": 300.0, "maxHp": 300.0,
	}
	buildings.append(b)
	auto_assign()
	return b


func can_afford(cost: Dictionary) -> bool:
	for k in cost.keys():
		if float(resources.get(k, 0.0)) < float(cost[k]):
			return false
	return true


func pay(cost: Dictionary) -> void:
	for k in cost.keys():
		resources[k] = float(resources.get(k, 0.0)) - float(cost[k])


## 把空闲人口自动分到岗位（岗位数 = def.jobs + jobSlots 科技）
func auto_assign() -> int:
	var idle := idle_pop()
	if idle <= 0:
		return 0
	var placed := 0
	for b in buildings:
		var def := def_of(String(b["type"]))
		var jobs := int(def.get("jobs", 0))
		if jobs <= 0:
			continue
		var max_workers := jobs + int(round(stats.stat("jobSlots")))
		while int(b.get("workers", 0)) < max_workers and idle > 0:
			b["workers"] = int(b.get("workers", 0)) + 1
			idle -= 1
			placed += 1
	return placed


## 生产：每名工人每秒产出（效率受 workerEfficiency）
func update_production(dt: float) -> Dictionary:
	var eff := 1.0 + stats.stat("workerEfficiency")
	var out: Dictionary = {}
	for b in buildings:
		var workers := int(b.get("workers", 0))
		if workers <= 0:
			continue
		var produce: Dictionary = def_of(String(b["type"])).get("produce", {})
		for k in produce.keys():
			var gain := float(produce[k]) * float(workers) * eff * dt
			resources[k] = float(resources.get(k, 0.0)) + gain
			out[k] = float(out.get(k, 0.0)) + gain
	return out


## 生产总览（UI 用）：每种资源每秒多少
func production_summary() -> Dictionary:
	var eff := 1.0 + stats.stat("workerEfficiency")
	var out: Dictionary = {}
	for b in buildings:
		var workers := int(b.get("workers", 0))
		if workers <= 0:
			continue
		var produce: Dictionary = def_of(String(b["type"])).get("produce", {})
		for k in produce.keys():
			out[k] = float(out.get(k, 0.0)) + float(produce[k]) * float(workers) * eff
	return out


## 防御力：哨站/兵营之类的固定值之和
func defense_power() -> float:
	var p := 0.0
	for b in buildings:
		p += DataLoader.num_or(def_of(String(b["type"])), "defense", 0.0)
	return p
