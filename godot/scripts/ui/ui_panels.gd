## 面板外壳 + 三个面板（属性 / 背包 / 科技）—— `src/ui/*.js` 那 16 个 DOM 面板的第一批移植。
##
## 与 DOM 版的对应关系：
##   - `panelShell` → 一个可复用的窗口（标题 + 页签 + 关闭），用 Godot 的 Control 树搭；
##   - 属性面板  → `panelStats`（把属性引擎的键翻成中文逐条列出）；
##   - 背包面板  → `panelInventory`（5 个装备槽 + 背包 + 排序，排序规则逐位照搬 JS）；
##   - 科技面板  → `panelTech`（可研发 / 已解锁，点击研发）。
##
## 为什么第一件事是「排序规则」的黄金对比：DOM 版里 `sortBag` 有五种模式，
## 每种都有自己的比较键与次关键字（品质→评分、部位→品质…），
## 是这批 UI 里唯一有真实逻辑的部分；排版本身只能靠肉眼。
class_name UiPanels

const RARITY_COLOR := {
	"common": Color("#c9d4e0"), "uncommon": Color("#6ee7a8"), "rare": Color("#59d8ff"),
	"epic": Color("#c08cff"), "relic": Color("#ff5f6d"),
}
const SLOT_NAMES := ["头盔", "胸甲", "护腿", "饰品 1", "饰品 2"]
const SLOT_ORDER := ["weapon", "helmet", "chest", "legs", "trinket", "misc"]
const SORTS := [
	{ "id": "rarity", "name": "品质" },
	{ "id": "type", "name": "部位" },
	{ "id": "score", "name": "评分" },
	{ "id": "weight", "name": "负重" },
	{ "id": "name", "name": "名称" },   # 少了 "name" 这一项会让 m["name"] 抛异常，把整个面板的后续内容全吞掉
]


## 背包排序 —— 与 `panelInventory.sortBag` 同规则（含次关键字），
## **必须是稳定排序**：JS 的 Array.sort 是稳定的，Godot 的 sort_custom 不是，
## 所以这里把原始下标当最后一级比较键。
static func sort_bag(items: Array, mode: String) -> Array:
	var list := items.duplicate()
	var with_idx: Array = []
	for i in list.size():
		with_idx.append({ "it": list[i], "i": i })
	var rank := func(it: Dictionary) -> int:
		return TechTree.RARITY_ORDER.find(String(it.get("rarity", "common")))
	var score := func(it: Dictionary) -> float:
		return TechTree.score_item(it)
	var weight := func(it: Dictionary) -> float:
		return TechTree.item_weight(it)
	var cmp := func(a: Dictionary, b: Dictionary) -> bool:
		var x: Dictionary = a["it"]
		var y: Dictionary = b["it"]
		var d := 0.0
		match mode:
			"type":
				var ka := SLOT_ORDER.find("weapon" if String(x.get("type", "")) == "weapon" else String(x.get("slot", "misc")))
				var kb := SLOT_ORDER.find("weapon" if String(y.get("type", "")) == "weapon" else String(y.get("slot", "misc")))
				d = float(ka - kb)
				if d == 0.0:
					d = float(rank.call(y) - rank.call(x))
			"score":
				d = score.call(y) - score.call(x)
			"weight":
				d = weight.call(y) - weight.call(x)
			"name":
				d = 0.0   # 名称排序交给调用方（Godot 没有 localeCompare 的等价物）
			_:
				d = float(rank.call(y) - rank.call(x))
				if d == 0.0:
					d = score.call(y) - score.call(x)
		if d != 0.0:
			return d < 0.0
		return int(a["i"]) < int(b["i"])
	with_idx.sort_custom(cmp)
	var out: Array = []
	for w in with_idx:
		out.append(w["it"])
	return out


## 属性面板的分组（把 123 个键翻成中文；只列玩家真正关心的）
const STAT_GROUPS := [
	{ "title": "生存", "keys": [["hpMax", "生命上限"], ["hpRegen", "生命回复"], ["armor", "护甲"],
		["shieldMax", "护盾"], ["shieldRegen", "护盾回复"], ["regenPct", "百分比回复"]] },
	{ "title": "移动", "keys": [["speedMult", "移动速度"], ["staminaMax", "耐力上限"],
		["staminaRegen", "耐力回复"], ["dodgeCdMult", "闪避冷却"]] },
	{ "title": "输出", "keys": [["damage", "武器伤害"], ["attackSpeed", "射速"],
		["projectiles", "额外弹道"], ["critChance", "暴击率"], ["critMult", "暴击倍率"],
		["rangeMult", "射程"], ["pierce", "穿透"], ["lifeSteal", "吸血"]] },
	{ "title": "防御塔", "keys": [["towerDamage", "塔伤害"], ["towerAttackSpeed", "塔攻速"],
		["towerRange", "塔射程"], ["towerCap", "塔上限"]] },
	{ "title": "经济", "keys": [["goldMult", "金币"], ["xpMult", "经验"], ["matMult", "材料"],
		["luck", "幸运"], ["carryMult", "背包"], ["mineSpeed", "采集速度"], ["mineYield", "采集产出"]] },
	{ "title": "吸引阵列", "keys": [["beaconRadiusMult", "阵列半径"], ["beaconIntensityMult", "吸引强度"],
		["beaconFuelMult", "耗能倍率"], ["beaconFuelRegen", "能量回复"]] },
]


## 给属性面板生成行：[{ group, label, value, pct }]
static func stat_rows(stats: StatSet) -> Array:
	var rows: Array = []
	for g in STAT_GROUPS:
		var group_rows: Array = []
		for pair in g["keys"]:
			var key := String(pair[0])
			var v := stats.stat(key)
			if v == 0.0:
				continue
			# 比率类显示成百分比，绝对值类直接显示
			var is_pct := key in ["speedMult", "damage", "attackSpeed", "critChance", "rangeMult",
				"lifeSteal", "towerDamage", "towerAttackSpeed", "towerRange", "goldMult", "xpMult",
				"matMult", "luck", "carryMult", "mineSpeed", "beaconRadiusMult",
				"beaconIntensityMult", "beaconFuelMult", "beaconFuelRegen", "hpRegen"]
			group_rows.append({
				"label": String(pair[1]),
				"text": ("+%d%%" % int(round(v * 100.0))) if is_pct else ("%d" % int(round(v))),
			})
		if not group_rows.is_empty():
			rows.append({ "group": String(g["title"]), "rows": group_rows })
	return rows


## 面板外壳：返回一个装满内容的窗口（调用方自己 add_child）
static func make_window(title: String, size: Vector2 = Vector2(720, 520)) -> PanelContainer:
	var win := PanelContainer.new()
	win.custom_minimum_size = size
	win.size = size
	win.set_anchors_preset(Control.PRESET_TOP_LEFT)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.07, 0.09, 0.13, 0.96)
	style.border_color = Color(0.35, 0.45, 0.58, 0.9)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	win.add_theme_stylebox_override("panel", style)
	var vbox := VBoxContainer.new()
	vbox.name = "Body"
	win.add_child(vbox)
	var head := Label.new()
	head.name = "Title"
	head.text = title
	head.add_theme_font_size_override("font_size", 20)
	vbox.add_child(head)
	return win


## 把一组「标题 + 行」塞进容器
static func fill_rows(container: Node, rows: Array, value_color: Color = Color("#8fe0ff")) -> int:
	var n := 0
	for r in rows:
		var head := Label.new()
		head.text = "— %s —" % String(r["group"])
		head.add_theme_font_size_override("font_size", 15)
		head.add_theme_color_override("font_color", Color("#8ba0bb"))
		container.add_child(head)
		for row in r["rows"]:
			var line := HBoxContainer.new()
			var l := Label.new()
			l.text = String(row["label"])
			l.custom_minimum_size = Vector2(160, 0)
			var v := Label.new()
			v.text = String(row["text"])
			v.add_theme_color_override("font_color", value_color)
			line.add_child(l)
			line.add_child(v)
			container.add_child(line)
			n += 1
	return n
