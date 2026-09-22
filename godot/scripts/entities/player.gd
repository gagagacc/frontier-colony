## 玩家 —— `src/systems/player.js` 的移动部分（阶段 5 先做「能走」）。
##
## 移动走的是**移植后的碰撞与贴墙滑行**（`world.try_move`），
## 所以「会不会被地形卡住」这件事和 JS 版是同一条代码路径。
extends Node2D

const RADIUS := 13.0
const WALK_SPEED := 220.0
const SPRINT_MULT := 1.45

var world: GdWorld
var vel := Vector2.ZERO
var facing := 0.0
var sprinting := false
var stamina := 100.0
var move_model: PlayerMove = null
var carry_used := 0.0
var carry_max := 24.0
var hp := 122.0
var hp_max := 122.0
var _dust := 0.0

## 阶段 5：武器状态机 + 弹丸系统（数值全部走 WeaponMath / weapons.json）
var stats: StatSet
var loadout: Loadout
var projectiles: Node2D
var aim := 0.0
var _muzzle_flash := 0.0
var repair_flash := 0.0   # 正在维修：画一圈绿光（JS 的 repairFlash 同义）


func setup(p_world: GdWorld, x: float, y: float) -> void:
	world = p_world
	position = Vector2(x, y)


## 装配武器与弹药（由 Game 场景在世界生成后调用）
func equip_weapon(weapon_def: Dictionary, p_stats: StatSet, p_projectiles: Node2D, rarity: String = "common") -> void:
	stats = p_stats
	projectiles = p_projectiles
	loadout = Loadout.new(stats)
	loadout.equip(weapon_def, rarity)
	hp_max = 122.0 + stats.stat("hpMax")
	hp = hp_max


func _physics_process(delta: float) -> void:
	if world == null:
		return
	# 死亡：只走复活计时，不接受操作（JS 里也是这样）
	if dead:
		_tick_death(delta)
		queue_redraw()
		return
	if invuln > 0.0:
		invuln = maxf(0.0, invuln - delta)
	var input := Vector2(
		Input.get_axis("move_left", "move_right"),
		Input.get_axis("move_up", "move_down"))
	if input.length() > 1.0:
		input = input.normalized()

	sprinting = Input.is_key_pressed(KEY_SHIFT) and stamina > 1.0
	# 速度/体力/闪避全部走 PlayerMove（数值来自 data/config.json 的 PLAYER，不再是手抄常量）
	if move_model == null:
		move_model = PlayerMove.new(self)
	var moving := input.length() > 0.01
	sprinting = sprinting and move_model.can_sprint(sprinting, moving, stamina)
	stamina = move_model.tick_stamina(stamina, sprinting, moving, stats, delta)
	var terrain_speed := world.speed_at_px(position.x, position.y) if world != null else 1.0
	var speed := move_model.speed_for(sprinting, stats, terrain_speed)

	# 闪避位移优先于普通移动
	var dodge_step := move_model.tick(delta)
	if dodge_step.length() > 0.01:
		var rd := world.try_move(position.x, position.y, RADIUS, dodge_step.x, dodge_step.y)
		position = Vector2(rd["x"], rd["y"])
		vel = move_model.dodge_dir * move_model.base_speed()
		queue_redraw()
		return
	vel = input * speed
	if input.length() > 0.01:
		facing = input.angle()
		var r := world.try_move(position.x, position.y, RADIUS, vel.x * delta, vel.y * delta)
		position = Vector2(r["x"], r["y"])
		_dust += delta * (2.0 if sprinting else 1.0)

	# 瞄准：鼠标方向（JS 版也是鼠标瞄准 + 左键开火）
	var mouse := get_global_mouse_position()
	aim = (mouse - position).angle()
	if facing == 0.0 and input.length() > 0.01:
		facing = aim

	if loadout:
		loadout.update(delta)
		if Input.is_key_pressed(KEY_R):
			loadout.start_reload()
		if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
			_fire()
	if _muzzle_flash > 0.0:
		_muzzle_flash = maxf(0.0, _muzzle_flash - delta * 6.0)

	queue_redraw()


func _fire() -> void:
	if projectiles == null or loadout == null:
		return
	var n := loadout.fire()
	if n <= 0:
		return
	# 射击几何走 Gunplay.plan_shot（弹道偏移/散布/枪口/半径/寿命/穿透一次算清，
	# 与 JS 的 fireWeapon 逐项对应；以前这里各写一份，散布默认值和弹道步长都对不上）
	var shots := Gunplay.plan_shot(loadout.def, stats, aim, position.x, position.y, world.rng)
	for s in shots:
		projectiles.spawn(float(s["x"]), float(s["y"]), float(s["angle"]), float(s["speed"]),
			float(s["damage"]), {
				"color": s["color"], "friendly": true, "pierce": int(s["pierce"]),
				"r": float(s["r"]), "life": float(s["life"]),
			})
	_muzzle_flash = 1.0


func _draw() -> void:
	# JS 版玩家是程序化小人（圆身 + 朝向指示）；这里保持同样的辨识度：
	# 深色外圈 + 亮色内圈 + 朝向小三角，脚下一圈淡淡的影子
	draw_circle(Vector2(0, 4), RADIUS + 2.0, Color(0, 0, 0, 0.25))
	draw_circle(Vector2.ZERO, RADIUS, Color("#2b3a4a"))
	draw_circle(Vector2.ZERO, RADIUS - 3.0, Color("#59d8ff"))
	draw_circle(Vector2.ZERO, RADIUS - 7.0, Color("#e8f6ff"))
	var tip := Vector2(cos(facing), sin(facing)) * (RADIUS + 9.0)
	var left := Vector2(cos(facing + 2.4), sin(facing + 2.4)) * (RADIUS + 1.0)
	var right := Vector2(cos(facing - 2.4), sin(facing - 2.4)) * (RADIUS + 1.0)
	draw_colored_polygon(PackedVector2Array([tip, left, right]), Color("#8fe0ff"))
	if dead:
		# 倒下：画一个灰色残影 + 复活倒计时（阶段 11 会换成正经的 UI 覆盖层）
		draw_circle(Vector2.ZERO, RADIUS, Color(0.25, 0.28, 0.32, 0.75))
		draw_string(ThemeDB.fallback_font, Vector2(-46, -28), "倒下了 %.1fs" % respawn_timer,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(1, 0.45, 0.5))
		return
	if invuln > 0.0:
		draw_arc(Vector2.ZERO, RADIUS + 6.0, 0, TAU, 24, Color(0.6, 0.9, 1.0, 0.7), 2.0)
	if hp < hp_max:
		var frac := clampf(hp / hp_max, 0.0, 1.0)
		draw_rect(Rect2(-20, -RADIUS - 16, 40, 5), Color(0, 0, 0, 0.55))
		draw_rect(Rect2(-19, -RADIUS - 15, 38 * frac, 3), Color("#ff5f6d"))

## 受击入口（由 Enemies 调用）。护甲按减伤百分比结算，与 JS 的 applyArmor 同式。
## 闪避（B 键 / 手柄 B）：位移 + 无敌帧，逻辑在 PlayerMove 里
func dodge() -> void:
	if dead or move_model == null:
		return
	var dir := Vector2(cos(aim), sin(aim)) if Input.is_key_pressed(KEY_SHIFT) else get_input_dir()
	if dir.length() < 0.01:
		dir = Vector2(cos(aim), sin(aim))
	stamina = move_model.start_dodge(dir, stamina)


func get_input_dir() -> Vector2:
	var v := Vector2.ZERO
	if Input.is_key_pressed(KEY_A): v.x -= 1.0
	if Input.is_key_pressed(KEY_D): v.x += 1.0
	if Input.is_key_pressed(KEY_W): v.y -= 1.0
	if Input.is_key_pressed(KEY_S): v.y += 1.0
	return v.normalized()


func take_damage(amount: float, source: String = "") -> void:
	if dead or invuln > 0.0:
		return
	if move_model != null and move_model.is_invulnerable():
		return   # 闪避无敌帧
	var dmg := amount
	if stats != null:
		dmg = EnemyFactory.apply_armor(dmg, stats.stat("armor"))
	hp = maxf(0.0, hp - dmg)
	_hurt_flash = 1.0
	# 挨打的反馈：震屏交给相机（强度随伤害大小，和 JS 的 SCREEN_SHAKE 同义）
	hurt.emit(clampf(dmg * 0.6, 2.0, 12.0))
	_last_hit_by = source
	if hp <= 0.0:
		die(source)


var _hurt_flash := 0.0
var _last_hit_by := ""

# =========================================================
#  死亡与复活（阶段 6 的尾巴）
# =========================================================

const REVIVE_TIME := 2.5          # 与 config.PLAYER.reviveTime 一致
const DEATH_GOLD_LOSS := 0.15     # 掉 15% 金币（有地窖实验则免）
const RESPAWN_HP_FRACTION := 0.6
const RESPAWN_INVULN := 3.0

signal died
signal hurt(mag: float)
signal respawned

var dead := false
var respawn_timer := 0.0
var invuln := 0.0
var deaths := 0
var dungeon_ref: DungeonFlow = null   # 副本里复活要回入口


func die(source: String = "") -> void:
	if dead:
		return
	dead = true
	hp = 0.0
	deaths += 1
	# 死亡惩罚：掉 15% 金币（有「深层地窖」类实验科技则免）
	if stats != null and stats.stat("deathPenaltyImmunity") > 0.0:
		print("[godot] 你倒下了 —— 深层地窖保住了物资")
	else:
		var lost := int(floor(float(gold_ref) * DEATH_GOLD_LOSS))
		gold_ref -= lost
		print("[godot] 你倒下了 —— 损失 %d 金币，救援舱正在赶来" % lost)
	# 基地已毁 + 玩家死亡 = 彻底失败（与 JS 的 GAME_OVER 分支一致）
	if base_destroyed:
		respawn_timer = 999.0
		print("[godot] 殖民地陷落 —— 基地已毁，无法复活")
		died.emit()
		return
	respawn_timer = REVIVE_TIME
	died.emit()


var base_destroyed := false


var gold_ref := 0


func _tick_death(dt: float) -> void:
	respawn_timer = maxf(0.0, respawn_timer - dt)
	if respawn_timer > 0.0:
		return
	respawn()


func respawn() -> void:
	dead = false
	hp = hp_max * RESPAWN_HP_FRACTION
	invuln = RESPAWN_INVULN
	# 玩家要求：「在虫巢死亡应该在基地复活」。
	# 原来是把人放在副本入口大厅（核心舱坐标在世界之外，按基地坐标复活会掉到地图外），
	# 但玩家不想再走一遍虫道 —— 现在改成**撤出副本、回地表基地**。
	if dungeon_ref != null and dungeon_ref.active:
		dungeon_ref.exit(self)
	position = Vector2(bases_pos.x + 70.0, bases_pos.y + 40.0)
	respawned.emit()
	print("[godot] 救援完成 —— 在基地医疗舱醒来（生命 %.0f/%.0f，无敌 %.1fs）" % [hp, hp_max, invuln])


var bases_pos := Vector2.ZERO