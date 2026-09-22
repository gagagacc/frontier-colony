## 科技树 / 实验科技 / 装备 —— `runState.unlockTech` + `experiments.js` + `loot.scoreItem` 的移植。
##
## 三条规则（都是玩家反馈打磨出来的）：
##   1. **科技是「解锁式」而不是等级式**：`unlockedTech` 是一个集合，
##      节点只有「解锁/未解锁」，效果通过 `StatSet.foldEffects` 折算 ——
##      所以「实验科技里再加一份伤害/攻速」会和科技树重叠（玩家指出过这个）。
##   2. **实验科技三种方向 → 四选一**，抽取权重按稀有度 × 权重 ÷ (1 + 已有等级×0.85)
##      —— 等级越高越难再抽到同一张。
##   3. 装备的 `stats` 走同一套 fold；卸下时必须**逐键减回去**（add/remove 对称）。
class_name TechTree

const EXP_RARITY_WEIGHT := { "common": 100, "rare": 46, "epic": 17, "legend": 4 }
const RARITY_ORDER := ["common", "uncommon", "rare", "epic", "relic"]

var unlocked: Dictionary = {}          # id -> true（集合语义）
var char_id := ""
var resources: Dictionary = {}
var beacon_level := 0
var beacon_max_level := 12


func _init(p_char_id: String = "engineer") -> void:
	char_id = p_char_id


func _tech_map() -> Dictionary:
	return DataLoader.by_id(DataLoader.new().table("tech", "TECH_DEF", []))


func tech_def(id: String) -> Dictionary:
	return _tech_map().get(id, {})


func is_unlocked(id: String) -> bool:
	return unlocked.has(id)


func can_afford(cost: Dictionary) -> bool:
	for k in cost.keys():
		if float(resources.get(k, 0.0)) < float(cost[k]):
			return false
	return true


func pay(cost: Dictionary) -> bool:
	if not can_afford(cost):
		return false
	for k in cost.keys():
		resources[k] = float(resources.get(k, 0.0)) - float(cost[k])
	return true


## 能不能解锁（与 JS `unlockTech` 的前置判断一致）
func can_unlock(id: String) -> bool:
	var def: Dictionary = tech_def(id)
	if def.is_empty() or is_unlocked(id):
		return false
	if def.has("exclusive") and String(def["exclusive"]) != char_id:
		return false
	if not can_afford(def.get("cost", {})):
		return false
	for r in def.get("req", []):
		if not is_unlocked(String(r)):
			return false
	return true


## 解锁（成功返回 true）。吸引阵列等级直接生效，其余效果由 recompute 时折算。
func unlock(id: String) -> bool:
	if not can_unlock(id):
		return false
	var def: Dictionary = tech_def(id)
	pay(def.get("cost", {}))
	unlocked[id] = true
	var eff: Dictionary = def.get("effect", {})
	if eff.has("beaconLevel"):
		beacon_level = mini(beacon_max_level, beacon_level + int(eff["beaconLevel"]))
	return true


## 当前「可研发」的科技 id（前置满足 + 未解锁）
func available() -> Array:
	var out: Array = []
	for id in _tech_map().keys():
		var def: Dictionary = _tech_map()[id]
		if is_unlocked(String(id)):
			continue
		if def.has("exclusive") and String(def["exclusive"]) != char_id:
			continue
		var ok := true
		for r in def.get("req", []):
			if not is_unlocked(String(r)):
				ok = false
				break
		if ok:
			out.append(String(id))
	out.sort()
	return out


## 已解锁的防御塔（塔有 requires 时必须在 unlocks.towers 里）
func unlocked_towers(unlocks: Dictionary) -> Array:
	var towers: Array = unlocks.get("towers", [])
	var out: Array = []
	var defs: Dictionary = DataLoader.new().table("towers", "TOWER_DEF", {})
	for id in defs.keys():
		var t: Dictionary = defs[id]
		if t.has("exclusive") and String(t["exclusive"]) != char_id:
			continue
		if not t.has("requires") or t["requires"] == null:
			out.append(String(id))
		elif towers.has(String(id)):   # JS 是 set.has(t.id)，不是 requires
			out.append(String(id))
	out.sort()
	return out


func unlocked_structures(unlocks: Dictionary) -> Array:
	var out: Array = unlocks.get("structures", []).duplicate()
	out.sort()
	return out


func has_feature(unlocks: Dictionary, f: String) -> bool:
	return (unlocks.get("features", []) as Array).has(f)


# =========================================================
#  实验科技
# =========================================================

var _exp_list: Array = []

func _experiments() -> Array:
	if _exp_list.is_empty():
		_exp_list = DataLoader.new().table("experiments", "EXPERIMENTS", [])
	return _exp_list


## 某个方向的候选池（含角色专属过滤）。
## 注意：数据里的 dir 是**字符串**（dmin/defense/explore），不是数字下标。
func pool_for(dir: String) -> Array:
	var out: Array = []
	for e in _experiments():
		if String(e.get("dir", "")) != dir:
			continue
		if e.has("exclusive") and e["exclusive"] != null and String(e["exclusive"]) != char_id:
			continue
		out.append(e)
	return out


## 抽取权重：稀有度 × 权重 ÷ (1 + 已有等级 × 0.85)
static func weight_of(exp: Dictionary, level: int) -> float:
	var base := float(EXP_RARITY_WEIGHT.get(String(exp.get("rarity", "common")), 50))
	var w := base * (float(exp.get("weight", 100)) / 100.0)
	return w / (1.0 + float(level) * 0.85)


## 抽 4 张不重复的候选（消耗 rng；顺序与 JS 的 weighted 抽取一致）
func roll_options(rng: Rng, dir: String, owned: Dictionary) -> Array:
	var bag: Array = []
	for e in pool_for(dir):
		var lv := int(owned.get(String(e["id"]), 0))
		if lv < int(e.get("maxLv", 1)):
			bag.append(e)
	if bag.is_empty():
		return []
	var picked: Array = []
	var n := mini(4, bag.size())
	for i in n:
		var entries: Array = []
		for e in bag:
			entries.append({ "e": e, "w": weight_of(e, int(owned.get(String(e["id"]), 0))) })
		var entry = rng.weighted(entries)
		if entry == null:
			break
		picked.append(String(entry["id"]))
		bag.erase(entry)
	return picked


## 取一张实验（等级 +1）。**必须校验 id 真的存在** ——
## 面板上点一下就调用它，传错 id 会静默把垃圾写进存档。
func take_experiment(id: String, owned: Dictionary) -> bool:
	var found := false
	for e in _experiments():
		if String(e["id"]) == id:
			found = true
			break
	if not found:
		return false
	owned[id] = int(owned.get(id, 0)) + 1
	return true


## 刷新费用：45 × 1.85^次数 × (1 - 折扣)，下限 20（与 experiments.js 的 refreshCost 同式）
static func refresh_cost(refresh_count: int, discount: float = 0.0) -> int:
	var base := 45.0 * pow(1.85, float(refresh_count))
	return maxi(20, int(round(base * (1.0 - GdMath.clampf01(discount)))))


# =========================================================
#  装备
# =========================================================

## 装备评分（与 loot.scoreItem 同式）：稀有度 + 武器 DPS/射程 + 词缀加权
static func score_item(item: Dictionary) -> float:
	if item.is_empty():
		return 0.0
	var rarity := String(item.get("rarity", "common"))
	var r := float(RARITY_ORDER.find(rarity) + 1) * 12.0
	var s := r
	if String(item.get("type", "")) == "weapon":
		var def: Dictionary = item.get("def", {})
		if def.is_empty():
			var wdefs: Dictionary = DataLoader.new().table("weapons", "WEAPON_DEF", {})
			var got = wdefs.get(String(item.get("weaponId", "")), {})
			if got is Dictionary:
				def = got
		if not def.is_empty():
			s += (DataLoader.num_or(def, "damage", 10.0) / maxf(0.08, DataLoader.num_or(def, "cd", 0.5))) * 0.9
			s += DataLoader.num_or(def, "range", 0.0) * 0.02
	var stats: Dictionary = item.get("stats", {})
	for k in stats.keys():
		var v = stats[k]
		if not (v is float or v is int):
			continue
		var fv := float(v)
		if k == "damage" or k == "attackSpeed":
			s += fv * 90.0
		elif k == "hpMax":
			s += fv * 0.5
		elif k == "armor":
			s += fv * 1.4
		else:
			s += absf(fv) * 12.0
	return s


static func item_weight(item: Dictionary) -> float:
	if item.is_empty():
		return 0.0
	var r := float(RARITY_ORDER.find(String(item.get("rarity", "common"))) + 1)
	return (6.0 + r) if String(item.get("type", "")) == "weapon" else (4.0 + r)
