## 玩家的武器状态机 —— `player.js` 里开火 / 换弹 / 弹药那一段的移植。
##
## 设计上刻意与渲染解耦：这里只管「能不能开火、扣多少弹药、什么时候换完」，
## 弹丸的生成交给 ProjectileSystem。
class_name Loadout

var stats: StatSet
var def: Dictionary = {}          # 当前武器数据（来自 weapons.json）
var rarity := "common"
var cd := 0.0                     # 距离下次可开火的剩余秒数
var reloading := 0.0              # 换弹剩余秒数（0 = 没在换）
var reload_total := 0.0
var ammo := 160
var ammo_max := 200
var ammo_frac := 0.0
var shots_fired := 0
var barrels := 1
## 换弹要花资源：这里拿的是「当前这一局的资源表」（由 Game 接进来）
var resources: Dictionary = {}
## 只有 start_reload() 会置位；没置位就算进度走完也不给子弹（见上面的注释）
var reload_pending := false
var reload_auto := false
var last_reload_result := ""
var warned_no_ammo := false


func _init(p_stats: StatSet) -> void:
	stats = p_stats


func equip(weapon_def: Dictionary, p_rarity: String = "common") -> void:
	def = weapon_def
	rarity = p_rarity
	cd = 0.0
	reloading = 0.0
	barrels = WeaponMath.weapon_barrels(stats)


func cooldown() -> float:
	return WeaponMath.weapon_cooldown(stats, def)


func range() -> float:
	return WeaponMath.weapon_range(stats, def)


func reload_time() -> float:
	return WeaponMath.reload_time_of(def, rarity)


## 能不能开火（冷却好了、没在换弹、还有弹药）
func can_fire() -> bool:
	if def.is_empty() or cd > 0.0 or reloading > 0.0:
		return false
	var p := { "ammo": ammo, "ammo_frac": ammo_frac }
	return WeaponMath.can_spend_ammo(stats, def, p)


## 开一次火：扣弹药、起冷却；打空自动开始换弹。
## 返回本次发射的弹道条数（0 = 没打成），由调用方决定弹丸怎么飞。
func fire() -> int:
	if not can_fire():
		return 0
	var p := { "ammo": float(ammo), "ammo_frac": ammo_frac }
	WeaponMath.spend_ammo(stats, def, p)
	ammo = int(p["ammo"])
	ammo_frac = float(p["ammo_frac"])
	cd = cooldown()
	shots_fired += 1
	if ammo <= 0 and ammo_frac <= 0.0:
		auto_reload()   # 打空自动尝试换弹（与 JS 的 autoReload 同一入口）
	return barrels


## 开始换弹 —— 与 JS `runState.beginReload(auto)` 逐条对应：
##
##   1. 正在换弹 / 弹药已满 → 拒绝；
##   2. **要花金属**：`ceil(需补数量 × 0.12 × ammoCostMult)`（有「现场合成弹药」实验时
##      额外吃硫磺并**瞬间补满**）；
##   3. 金属不够 → 拒绝，并且**自动换弹失败只提示一次**（不然打空时会刷屏）；
##   4. **`reload_pending` 只有这里会置位** —— 这是 JS 注释里专门写下的设计：
##      「空仓干等那 1.2 秒白送 30 发」的旧漏洞不会再出现；
##      没置位就算 `reloading` 归零也**只清进度、不给子弹**。
func start_reload(auto: bool = false) -> bool:
	if reloading > 0.0 or def.is_empty():
		return false
	if ammo >= ammo_max:
		last_reload_result = "full"
		return false
	var need := ammo_max - ammo
	var cost_mult := 1.0 + stats.stat("ammoCostMult")
	var metal_cost := int(ceil(float(need) * 0.12 * cost_mult))
	var sulfur_cost := int(ceil(float(need) * 0.05 * cost_mult))
	if stats.stat("ammoCraft") > 0.0:
		# 现场合成：材料够就瞬间补满
		if float(resources.get("metal", 0.0)) < float(metal_cost) \
			or float(resources.get("sulfur", 0.0)) < float(sulfur_cost):
			last_reload_result = "no_material"
			return false
		resources["metal"] = float(resources.get("metal", 0.0)) - float(metal_cost)
		resources["sulfur"] = float(resources.get("sulfur", 0.0)) - float(sulfur_cost)
		ammo = ammo_max
		ammo_frac = 0.0
		reload_pending = false
		last_reload_result = "crafted"
		return true
	if float(resources.get("metal", 0.0)) < float(metal_cost):
		last_reload_result = "no_metal"
		return false
	resources["metal"] = float(resources.get("metal", 0.0)) - float(metal_cost)
	reload_total = reload_time()
	reloading = reload_total
	reload_pending = true      # ← 只有走到这里，换完才真的给子弹
	reload_auto = auto
	last_reload_result = "started"
	return true


## 打空时的自动换弹（JS 的 autoReload）：失败时**只提示一次**，不然会刷屏
func auto_reload() -> bool:
	if reloading > 0.0:
		return false
	var ok := start_reload(true)
	warned_no_ammo = not ok
	return ok


func update(dt: float) -> void:
	if cd > 0.0:
		cd = maxf(0.0, cd - dt)
	if reloading > 0.0:
		reloading = maxf(0.0, reloading - dt)
		if reloading == 0.0:
			# ⚠️ 只有 beginReload 置过位才补弹：空仓干等不给免费子弹
			if reload_pending:
				reload_pending = false
				ammo = ammo_max
				ammo_frac = 0.0
				warned_no_ammo = false
			reload_auto = false


func reload_progress() -> float:
	if reloading <= 0.0 or reload_total <= 0.0:
		return 0.0
	return 1.0 - reloading / reload_total
