## 玩家移动模型 —— `src/systems/player.js` 的 `updateMove` 移植（手感回归的第一刀）。
##
## 起因：Godot 侧原本把基础速度**手抄**成 220，而真值是 **172** —— 整整快 28%，
## 而且因为常量是抄的、没有走数据管线，一直没人发现。
## 现在这些数字统一从 `godot/data/config.json` 的 `PLAYER` 读。
##
## 完整模型（与 JS 逐项对应）：
##   速度 = baseSpeed × (1 + speedMult)
##          × 冲刺 1.42（且正在移动、体力 > 1）
##          × 击杀狂暴（开拓者）
##          × 负重惩罚（负载 > 90% 时按 (load-0.9)×1.2 递减，最低 55%）
##          × 地形速度
##   体力：冲刺 -17/s，否则 +21/s（再加科技 staminaRegen）
##   闪避：560 速度、0.19 秒、冷却 0.85 秒、无敌帧 0.28 秒、消耗 22 体力
class_name PlayerMove

var player: Node2D


func _init(p_player: Node2D) -> void:
	player = p_player


func cfg() -> Dictionary:
	return DataLoader.new().module("config").get("PLAYER", {})


func base_speed() -> float:
	return DataLoader.num(cfg(), "baseSpeed", 172.0)


func sprint_mult() -> float:
	return DataLoader.num(cfg(), "sprintMult", 1.42)


func stamina_max() -> float:
	return DataLoader.num(cfg(), "staminaMax", 100.0)


func speed_for(sprinting: bool, stats: StatSet, terrain_speed: float = 1.0,
	frenzy: bool = false, carry_used: float = 0.0, carry_max: float = 1.0) -> float:
	var speed := base_speed() * (1.0 + stats.stat("speedMult"))
	if sprinting:
		speed *= sprint_mult()
	if frenzy:
		speed *= 1.0 + stats.stat("killFrenzySpeed")
	var load := carry_used / maxf(1.0, carry_max)
	if load > 0.9:
		speed *= GdMath.clampv(1.0 - (load - 0.9) * 1.2, 0.55, 1.0)
	speed *= terrain_speed
	return speed


## 体力推进：返回新的体力值
func tick_stamina(stamina: float, sprinting: bool, moving: bool, stats: StatSet, dt: float) -> float:
	var want_sprint := sprinting and moving and stamina > 1.0
	if want_sprint:
		return maxf(0.0, stamina - DataLoader.num(cfg(), "sprintCost", 17.0) * dt)
	return minf(stamina_max(), stamina + (DataLoader.num(cfg(), "staminaRegen", 21.0)
		+ stats.stat("staminaRegen")) * dt)


## 能不能起步冲刺（JS：`sprint && moving && stamina > 1`）
func can_sprint(sprinting: bool, moving: bool, stamina: float) -> bool:
	return sprinting and moving and stamina > 1.0


# =========================================================
#  闪避
# =========================================================

var dodge_time_left := 0.0
var dodge_cd := 0.0
var iframes := 0.0
var dodge_dir := Vector2.ZERO


func dodge_cost() -> float:
	return DataLoader.num(cfg(), "dodgeCost", 22.0)


func can_dodge(stamina: float) -> bool:
	return dodge_cd <= 0.0 and stamina >= dodge_cost()


func start_dodge(dir: Vector2, stamina: float) -> float:
	if not can_dodge(stamina):
		return stamina
	dodge_dir = dir.normalized() if dir.length() > 0.01 else Vector2.RIGHT
	dodge_time_left = DataLoader.num(cfg(), "dodgeTime", 0.19)
	dodge_cd = DataLoader.num(cfg(), "dodgeCooldown", 0.85)
	iframes = DataLoader.num(cfg(), "dodgeIFrames", 0.28)
	return stamina - dodge_cost()


## 推进闪避/冷却/无敌帧；返回这一帧的位移（还没做碰撞）
func tick(dt: float) -> Vector2:
	dodge_cd = maxf(0.0, dodge_cd - dt)
	iframes = maxf(0.0, iframes - dt)
	if dodge_time_left <= 0.0:
		return Vector2.ZERO
	var step := minf(dt, dodge_time_left)
	dodge_time_left = maxf(0.0, dodge_time_left - dt)
	return dodge_dir * DataLoader.num(cfg(), "dodgeSpeed", 560.0) * step


func is_invulnerable() -> bool:
	return iframes > 0.0


func progress() -> float:
	var total := DataLoader.num(cfg(), "dodgeTime", 0.19)
	if total <= 0.0:
		return 0.0
	return GdMath.clampf01(1.0 - dodge_time_left / total)
