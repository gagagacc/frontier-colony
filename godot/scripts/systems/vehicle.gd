## 载具 —— `src/core/config.js` 的 VEHICLE + runState 的载具对象 + player 的上下车。
##
## 规则（含玩家的原话「载具速度原来是步行的 1.7 倍，地图被压得太小」）：
##   - 基础速度 240（步行 220，只快 1.4 倍），冲刺 ×1.55；
##   - 撞击怪物 22 点伤害，冷却 0.45 秒；
##   - 燃料 100，每秒 0.62；炮塔挂架最多 2 座（实验科技可以再加，但封顶 2 是硬规则）；
##   - 悬挂近战模块（撞角/电锯）最多 1 个。
class_name Vehicle

const BASE_SPEED := 240.0
const BOOST_MULT := 1.55
const CARGO_BASE := 24.0
const FUEL_MAX := 100.0
const FUEL_PER_SEC := 0.62
const COLLISION_DAMAGE := 22.0
const COLLISION_COOLDOWN := 0.45
const MAX_TURRETS := 2
const MAX_MELEE_MODULES := 1

var stats: StatSet
var x := 0.0
var y := 0.0
var hp := 420.0
var hp_max := 420.0
var fuel := FUEL_MAX
var destroyed := false
var mounted := false
var boosting := false
var collision_cd := 0.0
var angle := 0.0
var turrets: Array = []          # 挂载的炮塔（type 字符串）
var melee_module := ""
var kills := 0
var distance := 0.0


func _init(p_stats: StatSet = null) -> void:
	stats = p_stats if p_stats != null else StatSet.new()
	hp_max = 420.0 * (1.0 + stats.stat("vehicleHpMult"))
	hp = hp_max


func move_mult() -> float:
	return (1.0 + stats.stat("vehicleSpeedMult")) * (BOOST_MULT if boosting else 1.0)


func speed() -> float:
	# 与 config 一致：240 只比步行快 1.4 倍（削弱「跑图」的随意感）
	return BASE_SPEED * move_mult()


func cargo_cap() -> float:
	return CARGO_BASE + stats.stat("cargoBonus")


## 燃料消耗：地形越好越省（`terrainIgnore` 跳过地形影响）
func fuel_use(dt: float, terrain_speed: float = 1.0) -> float:
	var mult := 1.0 + stats.stat("fuelMult")
	if stats.stat("terrainIgnore") <= 0.0:
		mult *= 1.0 / maxf(0.5, terrain_speed)
	return FUEL_PER_SEC * mult * dt


func turret_cap() -> int:
	# 硬上限 2：实验科技能加，但总数不超过 MAX_TURRETS
	return mini(MAX_TURRETS, 2 + int(stats.stat("vehicleTurretCap")))


func can_mount_turret() -> bool:
	return turrets.size() < MAX_TURRETS


## 撞击怪物：返回本次能造成的伤害（冷却没好就是 0）
func ram_damage(dt: float) -> float:
	collision_cd = maxf(0.0, collision_cd - dt)
	if collision_cd > 0.0 or destroyed:
		return 0.0
	collision_cd = COLLISION_COOLDOWN
	return COLLISION_DAMAGE * (1.0 + stats.stat("ramMult"))


func mount() -> void:
	mounted = true


func dismount() -> void:
	mounted = false
	boosting = false


func tick(dt: float, terrain_speed: float = 1.0) -> void:
	if destroyed:
		return
	if mobile():
		fuel = maxf(0.0, fuel - fuel_use(dt, terrain_speed))
		if fuel <= 0.0:
			boosting = false
	var regen := stats.stat("fuelRegen")
	if regen > 0.0:
		fuel = minf(FUEL_MAX, fuel + regen * dt)


func mobile() -> bool:
	return mounted and fuel > 0.0 and not destroyed
