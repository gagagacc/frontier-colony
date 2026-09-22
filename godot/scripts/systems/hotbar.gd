## 快捷栏与拾取归属 —— `loot.addItemToInventory` + `actions.selectHotbar` 的移植。
##
## 两条**玩家明确要求**的规则（JS 注释里写着）：
##
##   1. **武器归属只看「有没有空位」**：快捷栏（4 格）有空位就直接放进去 ——
##      **不自动切换、也不比数值**。以前是「比当前武器强 15% 就自动替换」，
##      玩家捡到新枪却发现手上那把被换掉了、或者明明有空位却进了背包。
##   2. 护甲/饰品：有空槽自动穿，否则进背包。
##
## 数字键分工（与 JS 的 `selectHotbar` 一致）：
##   1-4 切武器 · 5 换弹 · 6/7/8 医疗包 / 兴奋剂 / 修理包。
class_name Hotbar

const MAX_WEAPONS := 4
const CONSUMABLES := ["medkit", "stimpack", "repairKit"]

var weapons: Array = []          # 每项 { id, name, rarity, def }
var weapon_index := 0
var equipment: Dictionary = {}   # slot -> item
var bag: Array = []
var bag_cap := 24
var item_counts: Dictionary = {} # 消耗品库存


func current_weapon() -> Dictionary:
	if weapons.is_empty() or weapon_index < 0 or weapon_index >= weapons.size():
		return {}
	return weapons[weapon_index]


## 捡到一件东西 → 返回 'hotbar' | 'equipped' | 'bag' | 'full'
func add_item(item: Dictionary) -> String:
	if String(item.get("type", "")) == "weapon":
		if weapons.size() < MAX_WEAPONS:
			weapons.append(item)
			if weapons.size() == 1:
				weapon_index = 0
			# ⚠️ 不自动切换、不与当前武器比数值 —— 只按「有没有位置」决定
			return "hotbar"
		return "bag" if push_to_bag(item) else "full"
	# 护甲 / 饰品：空槽自动穿
	var slot := String(item.get("slot", ""))
	if slot != "" and slot != "module":
		if not equipment.has(slot):
			equipment[slot] = item
			return "equipped"
	return "bag" if push_to_bag(item) else "full"


func push_to_bag(item: Dictionary) -> bool:
	if bag.size() >= bag_cap:
		return false
	bag.append(item)
	return true


## 数字键：返回这次按下的「动作」字符串（UI/音效据此反馈）
func select(index: int) -> String:
	if index < MAX_WEAPONS:
		if index < weapons.size():
			weapon_index = index
			return "equip"
		return "empty"
	if index == 4:
		return "reload"
	var id_index := index - 5
	if id_index >= 0 and id_index < CONSUMABLES.size():
		return use_item(String(CONSUMABLES[id_index]))
	return "none"


func use_item(id: String) -> String:
	var have := int(item_counts.get(id, 0))
	if have <= 0:
		return "no_item"
	item_counts[id] = have - 1
	return "used"


## 丢掉当前武器（背包满时掉在原地，与 JS 的 spawnPickup 同义）
func drop_current() -> Dictionary:
	if weapons.is_empty():
		return {}
	var w: Dictionary = weapons[weapon_index]
	weapons.remove_at(weapon_index)
	weapon_index = clampi(weapon_index, 0, maxi(0, weapons.size() - 1))
	return w


func weapon_names() -> Array:
	var out: Array = []
	for w in weapons:
		out.append(String(w.get("name", w.get("id", "?"))))
	return out
