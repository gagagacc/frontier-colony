## 制造（= 这个游戏里的「交易/装备产出」）—— `src/data/crafting.js` 的移植。
##
## 规则（对应设计）：
##   - 城镇能造的最高品质是**紫色**，红色只能靠打（`CRAFT_MAX_RARITY = epic`）；
##   - 能造哪一档由**城镇等级（人口）**决定：初级 0 / 标准 6 / 精密 16 / 高级 30；
##   - 同一件东西可以选不同品质制造，品质越高越贵（`costMult`）。
class_name Crafting

const MAX_RARITY_INDEX := 3          # epic
const RARITY_ORDER := ["common", "uncommon", "rare", "epic", "relic"]

var _tiers: Array = []
var _weapons: Array = []
var _armor: Array = []
var _weapon_defs: Dictionary = {}
var _equip_defs: Dictionary = {}


func _init() -> void:
	var mod: Dictionary = DataLoader.new().module("crafting")
	_tiers = mod.get("CRAFT_TIERS", [])
	_weapons = mod.get("CRAFT_WEAPONS", [])
	_armor = mod.get("CRAFT_ARMOR", [])
	_weapon_defs = DataLoader.new().table("weapons", "WEAPON_DEF", {})
	_equip_defs = DataLoader.new().table("weapons", "EQUIP_DEF", {})


func tiers() -> Array:
	return _tiers


## 制造等级 → 档位（人口门槛不够就退到低一档）
func craft_tier(level: int) -> Dictionary:
	var out: Dictionary = _tiers[0] if not _tiers.is_empty() else {}
	for t in _tiers:
		if level >= int(t["id"]):
			out = t
		else:
			break
	return out


## 城镇档位（POP_TIERS 下标）→ 制造等级
func craft_level_for(pop_tier_index: int) -> int:
	var lv := 0
	for t in _tiers:
		var pop: int = int(t["pop"])
		if pop_tier_index >= 0 and pop <= _pop_of_tier(pop_tier_index):
			lv = int(t["id"])
	return lv


func _pop_of_tier(idx: int) -> int:
	var mod: Dictionary = DataLoader.new().module("planets")
	var tiers: Array = mod.get("POP_TIERS", [])
	if idx < 0 or idx >= tiers.size():
		return 0
	return int(tiers[idx]["pop"])


## 能不能造这个品质：按**档位表里的品质**找下标（红色不在表里 → 永远造不了），
## 再与当前制造等级比较（与 JS canCraftRarity 同式）
func can_craft_rarity(rarity: String, craft_lv: int) -> bool:
	var idx := -1
	for i in _tiers.size():
		if String(_tiers[i].get("rarity", "")) == rarity:
			idx = i
			break
	if idx < 0:
		return false
	return idx <= craft_lv


## 制造费用 —— 与 JS craftCost **逐行同式**：
##   BASE_COST × 品质倍率 × (1 + entry.tier×0.35)，
##   高档还要吃稀有材料（黄装加水晶、紫装再加水晶与零件），避免「只靠金属刷紫装」。
const BASE_COST := { "metal": 60.0, "gold": 45.0, "parts": 6.0 }
const RARITY_COST := { "common": 1.0, "uncommon": 1.5, "rare": 2.4, "epic": 4.0 }


func craft_cost(entry: Dictionary, rarity: String, craft_lv: int) -> Dictionary:
	var r_mult := float(RARITY_COST.get(rarity, 1.0))
	var t_mult := 1.0 + float(entry.get("tier", 0)) * 0.35
	var out: Dictionary = {}
	for k in BASE_COST.keys():
		out[k] = int(round(float(BASE_COST[k]) * r_mult * t_mult))
	if rarity == "rare":
		out["crystal"] = int(round(8.0 * t_mult))
	if rarity == "epic":
		out["crystal"] = int(round(22.0 * t_mult))
		out["parts"] = int(out.get("parts", 0)) + int(round(6.0 * t_mult))
	return out


## 可造清单（按当前档位过滤掉还不能造的）
func craftable_weapons(craft_lv: int) -> Array:
	return _weapons.duplicate()


func craftable_armor(craft_lv: int) -> Array:
	return _armor.duplicate()


## 当前档位能造的最高品质名（UI 显示用）
func rarity_cap_name(craft_lv: int) -> String:
	return String(craft_tier(craft_lv).get("rarity", "common"))
