## 名字解析 —— 界面上**不许再出现英文键**（玩家要求：「把英文全翻译成中文」）。
##
## 名字全部来自数据表，不手抄：
##   - 资源：`tiles.json` 的 `RESOURCE_DEF[key].name`（金币 / 金属 / 晶体 / 零件 …）
##   - 品质：`weapons.json` 的 `RARITY_DEF[r].name`（普通 / 精良 / 稀有 / 史诗 / 传奇）
##   - 怪物 / 塔 / 建筑 / 科技 / 实验 / 星球：各自的 `name`
##
## 为什么要有这么一层：以前界面上到处是 `gold 90 · metal 25`、`common`、`epic`，
## 都是直接把字典的键打印出来了 —— 数据表里明明有中文名。
class_name Names

static var _res: Dictionary = {}
static var _rarity: Dictionary = {}
static var _mon: Dictionary = {}
static var _tow: Dictionary = {}
static var _str: Dictionary = {}
static var _tech: Dictionary = {}
static var _exp: Dictionary = {}
static var _item: Dictionary = {}


static func _res_defs() -> Dictionary:
	if _res.is_empty():
		_res = DataLoader.new().table("tiles", "RESOURCE_DEF", {})
	return _res


static func _rarity_defs() -> Dictionary:
	if _rarity.is_empty():
		_rarity = DataLoader.new().table("weapons", "RARITY_DEF", {})
	return _rarity


static func _mon_defs() -> Dictionary:
	if _mon.is_empty():
		_mon = DataLoader.new().table("monsters", "MONSTER_DEF", {})
	return _mon


static func _tow_defs() -> Dictionary:
	if _tow.is_empty():
		_tow = DataLoader.new().table("towers", "TOWER_DEF", {})
	return _tow


static func _str_defs() -> Dictionary:
	if _str.is_empty():
		_str = DataLoader.new().table("towers", "STRUCTURE_DEF", {})
	return _str


static func _tech_defs() -> Dictionary:
	if _tech.is_empty():
		_tech = DataLoader.by_id(DataLoader.new().table("tech", "TECH_DEF", []))
	return _tech


static func _exp_defs() -> Dictionary:
	if _exp.is_empty():
		_exp = DataLoader.by_id(DataLoader.new().table("experiments", "EXPERIMENTS", []))
	return _exp


## 资源名（金币/金属/晶体…）；查不到就退回原键（宁可显示键，也别显示空白）
static func resource(key: String) -> String:
	var d = _res_defs().get(key, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", key))
	# 「零件」等少数资源在别的表里
	var fallback := {
		"parts": "零件", "research": "研究资料", "tech": "数据核心", "dna": "基因样本",
		"biomass": "生物质", "beaconCore": "吸引核心",
	}
	return String(fallback.get(key, key))


static func resource_icon(key: String) -> String:
	var d = _res_defs().get(key, null)
	if d is Dictionary:
		return String((d as Dictionary).get("icon", ""))
	return ""


## 「金币 90 · 金属 25」——造价一行写完（够不够由调用方着色）
static func cost_line(cost: Dictionary, with_icon: bool = false) -> String:
	var parts: Array = []
	for k in cost.keys():
		var head := resource(String(k))
		if with_icon:
			var ic := resource_icon(String(k))
			if ic != "":
				head = ic + " " + head
		parts.append("%s %d" % [head, int(float(cost[k]))])
	return " · ".join(parts)


## 品质名（普通/精良/稀有/史诗/传奇）
static func rarity(key: String) -> String:
	var d = _rarity_defs().get(key, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", key))
	return key


## 品质颜色名（白/绿/黄/紫/红）—— 原版界面上就是这么叫的
static func rarity_color_name(key: String) -> String:
	var d = _rarity_defs().get(key, null)
	if d is Dictionary:
		return String((d as Dictionary).get("colorName", ""))
	return ""


static func rarity_hex(key: String) -> Color:
	var d = _rarity_defs().get(key, null)
	if d is Dictionary:
		return Color(String((d as Dictionary).get("color", "#c9d4e0")))
	return Color("#c9d4e0")


static func monster(id: String) -> String:
	var d = _mon_defs().get(id, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", id))
	return id


static func tower(id: String) -> String:
	var d = _tow_defs().get(id, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", id))
	if _str_defs().has(id):
		return String((_str_defs()[id] as Dictionary).get("name", id))
	return id


static func structure(id: String) -> String:
	var d = _str_defs().get(id, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", id))
	return id


static func tech(id: String) -> String:
	var d = _tech_defs().get(id, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", id))
	return id


static func experiment(id: String) -> String:
	var d = _exp_defs().get(id, null)
	if d is Dictionary:
		return String((d as Dictionary).get("name", id))
	return id


## 属性键 → 中文（属性面板用；表里没有的键保留原样，方便我发现漏网的）
const STAT_LABELS := {
	"hpMax": "生命上限", "hpRegen": "生命回复", "armor": "护甲", "shieldMax": "护盾上限",
	"shieldRegen": "护盾回复", "speedMult": "移动速度", "staminaMax": "耐力上限",
	"staminaRegen": "耐力回复", "damage": "武器伤害", "attackSpeed": "射速",
	"projectiles": "额外弹道", "critChance": "暴击率", "critMult": "暴击倍率",
	"rangeMult": "射程", "pierce": "穿透", "lifeSteal": "吸血",
	"towerDamage": "塔伤害", "towerAttackSpeed": "塔攻速", "towerRange": "塔射程",
	"towerCap": "塔上限", "towerCostMult": "塔造价", "structureHpMult": "建筑耐久",
	"goldMult": "金币收益", "xpMult": "经验收益", "matMult": "材料收益", "luck": "幸运",
	"carryMult": "背包容量", "mineSpeed": "采集速度", "mineYield": "采集产出",
	"beaconRadiusMult": "阵列半径", "beaconIntensityMult": "吸引强度",
	"beaconIntensity": "吸引强度加成", "beaconFuelMult": "耗能倍率",
	"beaconFuelRegen": "能量回复", "popGrowthMult": "人口增长", "jobSlots": "岗位数",
	"workerEfficiency": "工人效率", "foodEfficiency": "食物效率",
	"repairMult": "维修速度", "repairCostMult": "维修花费", "buildCostMult": "建造花费",
	"vehicleSpeedMult": "载具速度", "vehicleHpMult": "载具体力", "fuelMult": "油耗",
	"ramMult": "撞击伤害", "cargoBonus": "载货量", "ammoCostMult": "弹药花费",
	"deathPenaltyImmunity": "死亡免罚", "xpMult2": "经验收益",
}


static func stat(key: String) -> String:
	return String(STAT_LABELS.get(key, key))
