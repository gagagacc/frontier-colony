## 游戏主场景（阶段 4：能走能看）。
##
## 流程：生成世界 → 烘地块图集 → 铺地形 → 放玩家 → 相机跟随 → 小地图 + HUD。
## 世界生成目前是同步的（GDScript 实测约 5 秒），阶段 12 会改成
## 「第一次生成给进度条 + 结果缓存到 user://」。
extends Node2D

var world: GdWorld
var atlas: TileAtlas
var player: Node2D
var terrain: Node2D
var minimap: Control
var camera: Camera2D
var projectiles: Node2D
var enemies: Node2D
var towers: Node2D
var director: Director
var dungeon_flow: DungeonFlow
var props: Props
var vehicle: Vehicle
var town: Town
var settings: Settings
var crafting: Crafting
var tech_view: TechTreeView
var hotbar: Hotbar
var steam: SteamBridge
var cam_rig: CameraRig
## 前置界面（标题/模式/角色/星球/生成中）
var front_end: FrontEnd = null
## 开局前的默认参数（--menu=0 直进游戏时用）
class DefaultStart:
	static func params() -> Dictionary:
		return { "mode": "frontier", "character": "engineer",
			"seed": "", "planetIndex": 0, "nestScale": 1.0, "poiScale": 1.0, "compact": false }
## 受击顿帧：命中/挨打时把世界推进短暂放慢（0.05~0.12s），打击感靠它
var hitstop := 0.0
var hitstop_scale := 1.0
var base_destroyed_shown := false
var run_mode: RunMode
var _ach_timer := 2.0
var props_layer: Node2D
var tech: TechTree
var experiments: Dictionary = {}     # id -> 等级
var base_stats: StatSet

var gen_ms := 0
var atlas_ms := 0
var seed_text := "frontier-golden-a"
## 选中星球（前置界面决定；以前写死在 0）
var planet_index := 0
var show_debug := true
var _fps_sum := 0.0
var _fps_frames := 0
var _fps := 0.0

## 自动截图（给验证流水线用）：`-- --shot=<绝对路径> --frames=90 --seed=xxx --move=1,0`
## 为什么要游戏自己截图：Godot 是 GPU 渲染，用系统 API 抓窗口经常抓到别的窗口
## 或者一片黑；`get_viewport().get_texture().get_image()` 拿到的才是真实画面。
var shot_path := ""
var shot_frames := 90
var move_hint := Vector2.ZERO
## 自动截图时是否连续开火（用来截到飞行中的弹丸）
var auto_fire := 0
## 自动截图时是否自动进副本（阶段 9 的视觉验证）
var auto_dungeon := 0
## 自动截图时是否自动研发科技 + 抽实验（阶段 10 的验证）
var auto_tech := 0
## 自动截图：进副本后直接把玩家放到 Boss 房门口（看预警）
var boss_view := 0
## 自动截图：直接打开某个面板（0 属性 / 1 背包 / 2 科技）
var auto_panel := -1
## 自动截图：直接把主菜单打开（0 关 / 1 开）
var auto_menu := 1
## 自动截图：直接跳到前置界面的某一屏（0 标题 1 模式 2 角色 3 星球 5 设置）
var auto_flow := -1
## 自动截图：跑一遍存/读档往返（阶段 12 的实机验证）
var auto_saveload := 0
## 阶段 11：暂停 + 面板（Control 节点替代 DOM）
## 只有「落地之后」才推进模拟：前置界面期间世界还没生成，更不该有虫群
var playing := false
var paused := false
## 主菜单选择的开局参数（重载场景时用静态变量带过来）
static var start_params_static: Dictionary = {}
var show_menu := true
var menu: MainMenu = null   # 旧类，保留供老测试引用；实际流程走 front_end
var panel_tab := 0
var panel_root: Control = null
## 自动截图时是否自动铺基座+空投塔（阶段 7 的视觉验证）
var auto_build := 0


func _parse_cli() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seed="):
			seed_text = a.substr(7)
		elif a.begins_with("--shot="):
			shot_path = a.substr(7)
		elif a.begins_with("--frames="):
			shot_frames = int(a.substr(9))
		elif a.begins_with("--move="):
			var parts := a.substr(7).split(",")
			if parts.size() == 2:
				move_hint = Vector2(float(parts[0]), float(parts[1]))
		elif a.begins_with("--fire="):
			auto_fire = a.substr(7).to_int()
		elif a.begins_with("--build="):
			auto_build = a.substr(8).to_int()
		elif a.begins_with("--wavetimer="):
			lean_wave_seconds = a.substr(12).to_float()
		elif a.begins_with("--dungeon="):
			auto_dungeon = a.substr(10).to_int()
		elif a.begins_with("--tech="):
			auto_tech = a.substr(7).to_int()
		elif a.begins_with("--bossview="):
			boss_view = a.substr(11).to_int()
		elif a.begins_with("--panel="):
			auto_panel = a.substr(8).to_int()
		elif a.begins_with("--saveload="):
			auto_saveload = a.substr(11).to_int()
		elif a.begins_with("--menu="):
			auto_menu = a.substr(7).to_int()
			show_menu = auto_menu == 1
		elif a.begins_with("--flow="):
			auto_flow = a.substr(7).to_int()
	if seed_text == "" or seed_text == "frontier-golden-a":
		if shot_path == "":
			seed_text = "frontier-%d" % (Time.get_ticks_msec() % 100000)


func _ready() -> void:
	randomize()
	# 按键表来自原版的 binds.json（不再手抄键位）
	Binds.apply_to_input_map()
	_parse_cli()
	# 界面主题：中文像素字体 + 科幻面板皮（素材缺失会自动退回默认样式）
	get_window().theme = UiTheme.build()
	# 设置要在开局前的界面里就能生效（音量/窗口模式）
	settings = Settings.new()
	settings.load_settings()
	settings.apply(get_tree())
	show_debug = false
	camera = $Camera2D
	# 前置流程：标题 → 模式 → 角色 → 星球 → 生成 → 落地。
	# **在这之前不生成世界、不推进模拟** —— 以前是先开局再把菜单盖上去，
	# 结果玩家还在选角色，虫群已经在打基地了。
	if auto_menu == 1:
		_show_front_end()
	else:
		_start_run(DefaultStart.params())


## 真正开一局：生成世界 → 装配系统 → 开始模拟。
##
## 世界生成在 GDScript 里是阻塞的（约 4~5 秒），所以先让「生成中」那一屏画出来
## 再开始算 —— 明确等待比卡住强。参数全部来自前置界面（或 `--menu=0` 的默认值）。
func _start_run(params: Dictionary) -> void:
	start_params_static = params
	seed_text = String(params.get("seed", seed_text))
	planet_index = int(params.get("planetIndex", 0))
	if front_end != null:
		front_end.show_loading("星球 %d · 种子 %s · 模式 %s" % [
			planet_index + 1, seed_text, String(params.get("mode", "frontier"))])
		await get_tree().process_frame
		await get_tree().process_frame
	var t0 := Time.get_ticks_msec()
	world = GdWorld.new(seed_text, {
		"planetIndex": planet_index,
		"nestScale": params.get("nestScale", 1.0),
		"poiScale": params.get("poiScale", 1.0),
		"compact": params.get("compact", false),
	})
	var t1 := Time.get_ticks_msec()
	atlas = TileAtlas.new()
	atlas.build(DataLoader.new().table("tiles", "TILE_DEF", {}))
	atlas_ms = Time.get_ticks_msec() - t1

	projectiles = $Projectiles
	enemies = $Enemies
	towers = $Towers
	terrain = $Terrain
	terrain.setup(world, atlas, camera)

	player = $Player
	var start: Dictionary = world.base_site if world.base_site != null else { "x": float(Cfg.WORLD_PX) / 2.0, "y": float(Cfg.WORLD_PX) / 2.0 }
	var spawn: Dictionary = world.find_open_spot(float(start["x"]), float(start["y"]), 200.0)
	player.setup(world, float(spawn["x"]), float(spawn["y"]))
	camera.position = player.position

	minimap = $UI/Minimap
	minimap.setup(world, atlas, player)

	# 阶段 5：武器状态机 + 弹丸。数值全部来自 weapons.json 与移植后的属性引擎。
	_build_stats()
	var weapon_defs: Dictionary = DataLoader.new().table("weapons", "WEAPON_DEF", {})
	var starter := "pistol"
	var wdef: Dictionary = weapon_defs.get(starter, {})
	if wdef.is_empty():
		# 兜底：数据表里找不到就用第一把枪
		for k in weapon_defs.keys():
			if String(weapon_defs[k].get("kind", "")) == "bullet":
				wdef = weapon_defs[k]
				starter = String(k)
				break
	projectiles.setup(world, Callable(enemies, "hit_test"))
	enemies.setup(world, player, projectiles)
	player.equip_weapon(wdef, player_stats, projectiles)
	# 阶段 6 演示：在玩家附近撒一小波怪（阶段 8 的波次导演会接管）
	bases_pos = Vector2(spawn["x"], spawn["y"])
	player.bases_pos = bases_pos
	player.dungeon_ref = dungeon_flow
	player.gold_ref = 260
	towers.setup(world, player, projectiles, enemies, player_stats, bases_pos)
	# 阶段 8：波次导演 + 吸引阵列（燃料/半径/追杀模式）
	director = Director.new()
	director.setup(world, player_stats, enemies, player, camera, world.rng)
	tech = TechTree.new("engineer")
	tech.resources = { "gold": 3000.0, "metal": 1200.0, "crystal": 400.0, "parts": 200.0, "tech": 80.0, "research": 60.0 }
	# 阶段 11：可采集物（懒生成 + 采集交互）
	props = Props.new()
	props.setup(world)
	props_layer = $Props
	props_layer.setup(world, props, player, player_stats)
	# 换弹要花金属：资源表接进 loadout（JS 里是 run.resources）
	if player.loadout != null:
		player.loadout.resources = props_layer.resources
	# 阶段 12：载具实例（停在基地旁边）
	# 阶段 11：城镇（人口/岗位/生产）与制造
	settings = Settings.new()
	settings.load_settings()
	settings.apply(get_tree())
	# 默认不显示那行调试文本：HUD 接管了常用信息（按 H 可以再打开调试）
	show_debug = false
	cam_rig = CameraRig.new(1280.0, 720.0, world.rng)
	cam_rig.bounds = Vector2(float(Cfg.WORLD_TILES * Cfg.TILE), float(Cfg.WORLD_TILES * Cfg.TILE))
	cam_rig.snap_to(player.position.x, player.position.y)
	enemies.cam_rig_ref = cam_rig
	player.hurt.connect(func(mag: float) -> void: cam_rig.shake(mag))
	_build_action_bar()
	_build_gamepad_hint()
	_build_hud()
	if auto_menu == 0:
		show_menu = false
	# 截图/联调时用 --menu=0 直接进游戏（默认启动会先出主菜单）
	if show_menu and start_params_static.is_empty():
		_show_main_menu()
	else:
		_auto_start_dungeon_if_needed()
	town = Town.new(player_stats, tech.unlocked)
	town.resources = { "food": 60.0, "metal": 400.0, "gold": 600.0, "parts": 60.0, "crystal": 20.0, "water": 40.0 }
	town.bases = towers.bases
	crafting = Crafting.new()
	hotbar = Hotbar.new()
	# 把开局武器放进快捷栏第 1 格（不然「装备」页签永远是空的）
	hotbar.weapons.append({ "id": String(wdef.get("id", "pistol")),
		"name": String(wdef.get("name", "拓荒手枪")), "rarity": "common", "def": wdef })
	if auto_tech == 1:
		inv_demo_bag = _make_demo_bag()
	# 阶段 12：Steam（装了插件才真上报，否则只记本地）
	run_mode = RunMode.new(String(start_params_static.get("mode", "frontier")))
	steam = SteamBridge.new()
	steam.init_steam(480)
	steam.unlock("ACH_FIRST_LANDING")
	vehicle = Vehicle.new(player_stats)
	vehicle.x = bases_pos.x + 120.0
	vehicle.y = bases_pos.y + 90.0
	dungeon_flow = DungeonFlow.new()
	director.beacon_fuel = 40.0
	director.timer = lean_wave_seconds
	enemies.spawn_around(8, 260.0, 520.0, 2)

	print("[godot] 进入游戏 · 种子 %s · 世界生成 %d ms · 图集 %d ms · 图集哈希 %d" % [
		seed_text, gen_ms, atlas_ms, atlas.content_hash])
	print("[godot] 巢穴 %d · 地标 %d · 崖边签名 %d · 武器 %s（伤害 ×%.2f · 弹道 %d · 换弹 %.2fs）" % [
		world.nests.size(), world.pois.size(), terrain.solid_edge_signature(),
		starter, WeaponMath.weapon_damage_mult(player_stats),
		WeaponMath.weapon_barrels(player_stats),
		WeaponMath.reload_time_of(wdef, "common")])

	# 到这一步才算「落地」：前置界面收起来，HUD/行动栏显示，模拟开始推进。
	playing = true
	if front_end != null:
		front_end.detach()
		front_end = null
	if hud_root != null:
		hud_root.visible = true
	print("[godot] 落地 —— 模式 %s · 角色 %s" % [
		String(start_params_static.get("mode", "frontier")),
		String(start_params_static.get("character", "engineer"))])


## 玩家属性：角色基础 + 一点起始科技（阶段 10 会接上真正的科技树与装备）
var player_stats: StatSet


func _build_stats() -> void:
	var chars: Dictionary = DataLoader.new().module("characters")
	var char_id := String(start_params_static.get("character", "engineer"))
	var cdef: Dictionary = chars.get("CHAR_DEF", {}).get(char_id, {})
	if cdef.is_empty():
		char_id = "engineer"
		cdef = chars.get("CHAR_DEF", {}).get("engineer", {})
	player_stats = StatSet.new(cdef.get("base", {}))
	# 角色的被动数值项也要进属性引擎（修塔折扣 / 油耗 / 撞击 / 基因位…）
	var passive: Dictionary = cdef.get("passive", {})
	var numeric: Dictionary = {}
	for k in passive.keys():
		var v = passive[k]
		if v is float or v is int:
			numeric[String(k)] = float(v)
	if not numeric.is_empty():
		player_stats.add(numeric)
	player_stats.add({ "damage": 0.15, "attackSpeed": 0.1, "rangeMult": 0.2, "projectiles": 1 })
	# 玩家要求「驾驶员初始直接有载具」：载具本来是「探索」分支第一个科技解锁的，
	# 但驾驶员这个角色就是靠车吃饭的 —— 这里直接把 vehicle 特性给他。
	if char_id == "pilot":
		player_stats.add({ "vehicleUnlock": 1.0 })


func _process(delta: float) -> void:
	# 还没落地（前置界面期间）：世界根本还没生成，什么都不该推进。
	# 这一条就是「选角色的时候虫群已经在打基地」那个 bug 的正解。
	if not playing:
		if shot_path != "":
			_auto_shot()
		return
	# 暂停时**只停世界推进**，不能整个 return ——
	# 早先写成 `if paused: return`，结果连自动截图的帧计数也一起停了，
	# 带 --panel 跑截图时游戏直接挂住不退出（截图工具超时）。
	if not paused:
		# 顿帧：命中瞬间把世界推进压慢一点，打击感靠它
		var world_delta := delta
		if hitstop > 0.0:
			hitstop = maxf(0.0, hitstop - delta)
			world_delta = delta * hitstop_scale
			if hitstop <= 0.0:
				hitstop_scale = 1.0
		# 顿帧期间世界推进用 world_delta（现在只有敌人/弹丸吃这个缩放，够用且直观）
		enemies.update(world_delta)
		projectiles.update(world_delta)
		director.update(delta)
		_update_waves(delta)
		var mouse := get_global_mouse_position()
		towers.update_preview(mouse)
		towers.update(delta)
		props_layer.update(delta, Input.is_key_pressed(KEY_E), Input.is_key_pressed(KEY_E))
		# E 也用来修：附近有打残的塔/建筑就先修（与 JS 的「维修优先于采集」同序）
		_tick_repair(delta)
		_check_base_destroyed()
		town.update_population(delta)
		town.update_production(delta)
		var tier_change := town.update_tier()
		if GdMath.truthy(tier_change.get("rising", false)):
			print("[godot] 城镇升级：%s" % String(town.tier_for(town.population).get("name", "?")))
		if player and camera:
			# 相机：指数收敛跟随 + 震屏 + 边界钳制（全在 CameraRig 里，与 JS 的 camera.js 同式）
			cam_rig.follow(player.position.x, player.position.y, delta)
			cam_rig.update(delta)
			camera.position = cam_rig.render_pos()
	_fps_sum += delta
	_fps_frames += 1
	if _fps_sum >= 0.5:
		_fps = float(_fps_frames) / _fps_sum
		_fps_sum = 0.0
		_fps_frames = 0
	if hud_root != null:
		_update_hud()
	if show_debug:
		$UI/Debug.text = _debug_text()
		$UI/Debug.visible = true
	else:
		$UI/Debug.visible = false
	if shot_path != "":
		_auto_shot()


## 自动截图流程：按 `--move` 走一段 → 等到 `--frames` → 存 PNG → 退出
var _shot_frame := 0

func _auto_shot() -> void:
	_shot_frame += 1
	if move_hint != Vector2.ZERO and _shot_frame < shot_frames - 30:
		var r := world.try_move(player.position.x, player.position.y, 13.0,
			move_hint.x * 220.0 * get_process_delta_time(),
			move_hint.y * 220.0 * get_process_delta_time())
		player.position = Vector2(r["x"], r["y"])
		player.facing = move_hint.angle()
	if auto_build == 1 and _shot_frame == 40:
		_auto_build_towers()
	if auto_saveload == 1 and _shot_frame == 40:
		_auto_saveload_test()
	# 面板要等副本进完再开（进副本是阻塞调用，帧号会停在原地）
	var panel_frame := 60 if auto_dungeon == 1 else 30
	if auto_panel >= 0 and _shot_frame == panel_frame:
		panel_tab = auto_panel
		if not paused:
			toggle_pause()
		else:
			_refresh_panel()
	if boss_view == 1 and _shot_frame == 60 and dungeon_flow.active:
		var bd: Dictionary = dungeon_flow.dungeon_world.dungeon["boss"]
		player.position = Vector2(float(bd["x"]) - 220.0, float(bd["y"]))
		camera.position = player.position
		camera.reset_smoothing()
	if auto_tech == 1 and _shot_frame == 20:
		for i in 6:
			research_next()
		for i in 4:
			roll_and_take_experiment("defense")
	if auto_dungeon == 1 and _shot_frame == 30:
		_enter_nearest_nest()
	if auto_fire == 1 and _shot_frame > 20:
		# 朝最近的怪开火（真人也是这么打的），这样能顺带验证命中→伤害→击杀→掉落
		var target: Variant = _nearest_enemy()
		if target != null:
			player.aim = (target - player.position).angle()
		player._fire()
	if _shot_frame < shot_frames:
		return
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(shot_path)
	print("[godot] 截图 %s → %s（%d 帧，FPS %.0f）" % [
		"OK" if err == OK else "失败(%d)" % err, shot_path, _shot_frame, _fps])
	get_tree().quit(0 if err == OK else 1)


func _nearest_enemy() -> Variant:
	var best: Variant = null
	var best_d := 1.0e18
	for e in enemies.enemies:
		if GdMath.truthy(e.get("dead", false)):
			continue
		var ex := float(e["x"])
		var ey := float(e["y"])
		var d := GdMath.dist(player.position.x, player.position.y, ex, ey)
		if d < best_d:
			best_d = d
			best = Vector2(ex, ey)
	return best


func _debug_text() -> String:
	var p := player.position
	var tile_id: int = world.tile_at_px(p.x, p.y)
	var biome: int = world.biome_at_px(p.x, p.y)
	var defs: Dictionary = DataLoader.new().table("tiles", "TILE_DEF", {})
	var td = defs.get(str(tile_id), defs.get(tile_id, {}))
	var name := String(td.get("name", "?")) if td is Dictionary else "?"
	return "\n".join([
		"开拓者：殖民地 —— Godot 移植版（阶段 5）",
		"种子 %s · FPS %.0f · 可见格 %d · 崖边 %d · 怪 %d · 弹丸 %d（命中 %d）" % [
			seed_text, _fps, terrain.visible_tiles, terrain.drawn_edges,
			enemies.count(), projectiles.count(), projectiles.hits],
		"坐标 (%d, %d) · 地块「%s」(%d) · 群系 %d · 速度 %.2f" % [
			int(p.x), int(p.y), name, tile_id, biome, world.speed_at_px(p.x, p.y)],
		"弹药 %d/%d%s · 武器 %s · 伤害 ×%.2f · 射速 ×%.2f · 弹道 %d%s" % [
			player.loadout.ammo, player.loadout.ammo_max,
			"（换弹中 %.0f%%）" % (player.loadout.reload_progress() * 100.0) if player.loadout.reloading > 0.0 else "",
			String(player.loadout.def.get("name", "?")),
			WeaponMath.weapon_damage_mult(player_stats),
			1.0 / maxf(0.01, WeaponMath.weapon_cooldown(player_stats, player.loadout.def)),
			WeaponMath.weapon_barrels(player_stats), ""],
		"击杀 %d · 经验 %d · 金币 %d · 掉弹 %d · 生命 %.0f/%.0f" % [
			enemies.kills, enemies.xp_total, enemies.gold_total, enemies.ammo_dropped, player.hp, player.hp_max],
		"塔 %d（基座上 %d） · 建筑 %d · N 撒一波怪 · 1 铺基座 · 2 空投塔" % [
			towers.count(), towers.towers.filter(func(t2): return GdMath.truthy(t2["onPlatform"])).size(), towers.structures.size()],
		"科技 %d 项 · 实验 %d 张 · 伤害 ×%.2f · 生命上限 %.0f" % [tech.unlocked.size(), experiments.size(),
			WeaponMath.weapon_damage_mult(player_stats), player_stats.stat("hpMax") + 122.0],
		"材料：%s" % _materials_text(),
		"流场重算 %d 次（末次 %d ms）" % [enemies._flow_calls, enemies._last_flow_ms],
		"WASD 移动 · Shift 冲刺 · 左键开火 · R 换弹 · F 流场箭头 · G 小地图 · H 调试 · N 撒怪",
	])


func _unhandled_input(event: InputEvent) -> void:
	# 放置模式：左键落位、右键取消（与 JS 的 pendingPlacement 同流程）
	if placing_tower and event is InputEventMouseButton and event.pressed:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_confirm_placement()
			get_viewport().set_input_as_handled()
			return
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			_cancel_placement()
			get_viewport().set_input_as_handled()
			return
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	# 按键分发全部走 _key_action（与 JS 版 main.js 的规则逐条对应）
	_key_action(event.physical_keycode)


# =========================================================
#  按键路由 —— 与 JS 版 `main.js` 的分发逐条对应
# =========================================================
#
# 原版规则（照抄，不自行发挥）：
#   1. `pause`（Esc）**任何时候都有效**：面板开着时用它关闭；
#      放置模式下它的意思是「结束建造」，不是「取消暂停」；
#   2. **面板开着时只允许 Esc（或用另一个面板键切过去）**，避免叠面板；
#   3. 每个面板一个键：T 科技 / G 城镇 / V 实验 / Tab 背包 / M 地图；
#   4. `build`（B）：**已在放置模式里 → 再按一次是取消**，否则打开建造面板；
#   5. F5 快存 / F9 快读 / F3 调试文本 / F4 流场箭头；
#   6. 快捷栏 1-8；Q 切武器 / R 换弹；
#   7. Space 闪避 / E 采集维修 / F 载具·虫巢·遗迹 / C 接管炮塔 / X 拾取 / Z 标记。

## 面板动作 → 页签下标（见 TAB_NAMES）
const PANEL_TAB := {
	"tech": 2, "build": 3, "map": 4, "town": 5, "experiments": 6, "inventory": 1,
}


func _key_action(key: int) -> void:
	var act := _action_of_key(key)
	# ① Esc：放置中 → 结束建造；面板开着 → 关；否则切暂停
	if key == KEY_ESCAPE:
		if placing_tower:
			_cancel_placement()
		else:
			toggle_pause()
		get_viewport().set_input_as_handled()
		return
	# ② 面板开着：只处理「切到另一个面板」
	if paused:
		if act != "" and PANEL_TAB.has(act):
			panel_tab = int(PANEL_TAB[act])
			_refresh_panel()
			get_viewport().set_input_as_handled()
		return
	if act == "":
		return
	match act:
		# ③ 面板直达（原版一个面板一个键）
		"tech", "town", "experiments", "inventory", "map":
			panel_tab = int(PANEL_TAB[act])
			toggle_pause()
			get_viewport().set_input_as_handled()
		"build":
			if placing_tower:
				_cancel_placement()
			else:
				panel_tab = int(PANEL_TAB["build"])
				toggle_pause()
			get_viewport().set_input_as_handled()
		# ④ 玩法动作
		"dodge":
			player.dodge()
			get_viewport().set_input_as_handled()
		"vehicle":
			_interact_vehicle_or_nest()
			get_viewport().set_input_as_handled()
		"swapWeapon":
			if hotbar.weapons.size() > 1:
				hotbar.select((hotbar.weapon_index + 1) % hotbar.weapons.size())
				_recompute_stats()
			get_viewport().set_input_as_handled()
		"reload":
			player.loadout.start_reload(false)
			get_viewport().set_input_as_handled()
		"ping":
			cam_rig.shake(2.0, 0.12)
			get_viewport().set_input_as_handled()
		"interact":
			# E：采集 / 维修由 _tick_repair 与 props_layer 处理（按住即可），这里只做遗迹搜刮
			var poi: Variant = _nearest_ruin()
			if poi != null:
				_loot_ruin(poi)
				get_viewport().set_input_as_handled()
		"slot1", "slot2", "slot3", "slot4", "slot5", "slot6", "slot7", "slot8":
			var idx := int(act.substr(4).to_int()) - 1
			if idx < Hotbar.MAX_WEAPONS:
				if hotbar.select(idx) == "equip":
					_recompute_stats()
			get_viewport().set_input_as_handled()


## 这个键绑到了哪个动作（查的是同一张 binds.json，不再是手写 match）
func _action_of_key(key: int) -> String:
	var binds := Binds.defaults()
	for action in binds.keys():
		for code in binds[action]:
			var k: Variant = Binds.CODE_TO_KEY.get(String(code), null)
			if k != null and int(k) == key:
				return String(action)
	return ""


## F 键：上/下车 · 进虫巢 · 与遗迹交互（**同一个键，按最近的来**，与 JS 一致）
func _interact_vehicle_or_nest() -> void:
	# ① 车上 → 下车；车旁 → 上车
	if vehicle.mounted:
		vehicle.dismount()
		print("[godot] 下车")
		return
	var dv := GdMath.dist(player.position.x, player.position.y, vehicle.x, vehicle.y)
	if dv < 70.0 and vehicle.hp > 0.0:
		vehicle.mount()
		print("[godot] 上车（油 %d%%）" % int(vehicle.fuel))
		return
	# ② 副本里：走到入口才能撤
	if dungeon_flow.active:
		if dungeon_flow.near_entry(self):
			dungeon_flow.exit(self)
		else:
			print("[godot] 要回地表得走到入口大厅")
		return
	# ③ 巢穴入口：**必须站在巢口**（这是「不能随处进」的判据）
	var nest = _nearest_nest_entry()
	if nest != null:
		dungeon_flow.enter(self, int(nest["tier"]))
		return
	# ④ 废弃基地 / 遗迹
	var poi: Variant = _nearest_ruin()
	if poi != null:
		_loot_ruin(poi)
		return
	print("[godot] 附近没有可交互的东西（巢口 / 载具 / 遗迹）")


## 距离最近且**够近**的巢穴入口；太远返回 null
func _nearest_nest_entry(max_dist: float = 120.0) -> Variant:
	var best: Variant = null
	var best_d := max_dist
	for nest in world.nests:
		if GdMath.truthy(nest.get("destroyed", false)):
			continue
		var d := GdMath.dist(player.position.x, player.position.y, float(nest["x"]), float(nest["y"]))
		if d < best_d:
			best_d = d
			best = nest
	return best


## 废弃基地 / 遗迹（worldgen 的 POI）：搜刮给材料 + 有概率给装备
func _nearest_ruin(max_dist: float = 90.0) -> Variant:
	var best: Variant = null
	var best_d := max_dist
	for poi in world.pois:
		if GdMath.truthy(poi.get("looted", false)):
			continue
		var d := GdMath.dist(player.position.x, player.position.y, float(poi["x"]), float(poi["y"]))
		if d < best_d:
			best_d = d
			best = poi
	return best


func _loot_ruin(poi: Dictionary) -> void:
	poi["looted"] = true
	var kind := String(poi.get("name", poi.get("kind", "遗迹")))
	var metal := 12 + int(world.rng.range_i(0, 18))
	var parts := 2 + int(world.rng.range_i(0, 5))
	props_layer.resources["metal"] = float(props_layer.resources.get("metal", 0.0)) + float(metal)
	props_layer.resources["parts"] = float(props_layer.resources.get("parts", 0.0)) + float(parts)
	var got_equip := world.rng.chance(0.35)
	if got_equip:
		var edefs: Dictionary = DataLoader.new().table("weapons", "EQUIP_DEF", {})
		if not edefs.is_empty():
			var keys: Array = edefs.keys()
			var id := String(keys[world.rng.range_i(0, keys.size() - 1)])
			var d: Dictionary = edefs[id]
			var rarities := ["common", "uncommon", "rare", "epic"]
			var rarity := String(rarities[world.rng.range_i(0, rarities.size() - 1)])
			hotbar.add_item({ "id": id, "type": "armor", "slot": String(d.get("slot", "chest")),
				"name": String(d.get("name", id)), "rarity": rarity, "def": d,
				"stats": { "armor": 6.0, "hpMax": 20.0 } })
	print("[godot] 搜刮%s：金属 +%d · 零件 +%d%s" % [kind, metal, parts,
		" · 装备一件" if got_equip else ""])
	cam_rig.shake(3.0, 0.15)


## 放置模式：B → 建造面板 → 选塔 → 鼠标预览 + 左键落位（与 JS 的 pendingPlacement 同流程）
var placing_tower := false


func _begin_placement(tower_id: String) -> void:
	towers.selected = tower_id
	placing_tower = true
	if paused:
		toggle_pause()
	if panel_root != null:
		panel_root.visible = false
	print("[godot] 进入放置模式：%s（鼠标左键落位 · B 或 Esc 取消）" % tower_id)


func _cancel_placement() -> void:
	placing_tower = false
	print("[godot] 已取消放置")


func _confirm_placement() -> void:
	var mouse := get_global_mouse_position()
	var t: Dictionary = towers.place_tower(mouse, {})
	if t.is_empty():
		print("[godot] 这里放不下（间隔 / 障碍 / 超出建造范围）")
	else:
		print("[godot] 空投 %s → (%.0f, %.0f)" % [towers.selected, mouse.x, mouse.y])
		placing_tower = false



## 自动截图用：基地旁边铺一排基座 + 各空投一座塔，验证「基座免间隔」在实机里的表现
func _auto_build_towers() -> void:
	var b := Vector2(bases_pos.x, bases_pos.y)
	# 一条相邻基座（间隔正好一格）
	for i in 4:
		towers.place_structure("turretSlot", b + Vector2(-140 + i * Cfg.TILE, 180))
	# 基座上的塔（可以贴着一格一座）
	for i in 4:
		towers.selected = "sentry"
		towers.place_tower(b + Vector2(-140 + i * Cfg.TILE, 180), { "instant": true })
	# 空地上一座（用来对比：它周围一圈不能贴第二座）
	towers.selected = "sentry"
	towers.place_tower(b + Vector2(200, -140), { "instant": true })
	print("[godot] 自动建造：塔 %d 座（基座上 %d）· 建筑 %d" % [
		towers.count(),
		towers.towers.filter(func(t): return GdMath.truthy(t["onPlatform"])).size(),
		towers.structures.size()])


var bases_pos := Vector2.ZERO

## 波次推进（阶段 8 的最小接线；阶段 11 会接上完整的 UI 提示）
var lean_wave_seconds := 25.0   # 可用 --wavetimer=N 缩短（截图/联调用）
var _wave_spawned := false

func _update_waves(dt: float) -> void:
	if director == null:
		return
	match director.state:
		Director.State.CALM:
			director.timer -= dt
			if director.timer <= 0.0:
				var info := director.start_wave()
				print("[godot] 第 %d 波：%d 只，来自 %d 个巢穴" % [
					director.wave_number, int(info.get("count", 0)), int(info.get("contributors", 0))])
				_wave_spawned = false
		Director.State.INCOMING:
			director.timer -= dt
			if director.timer <= 0.0:
				director.state = Director.State.ACTIVE
		Director.State.ACTIVE:
			if not _wave_spawned:
				var n := director.spawn_wave()
				_wave_spawned = true
				print("[godot] 本波已投放 %d 只（刷怪点走四档规则）" % n)

## 找最近的巢穴并进去（阶段 9 的临时入口；阶段 11 会有正经的交互提示）
func _enter_nearest_nest() -> void:
	var best = null
	var best_d := 1.0e18
	for n in world.nests:
		if GdMath.truthy(n.get("destroyed", false)):
			continue
		var d := GdMath.dist(player.position.x, player.position.y, float(n["x"]), float(n["y"]))
		if d < best_d:
			best_d = d
			best = n
	if best == null:
		print("[godot] 附近没有巢穴，进不了副本")
		return
	dungeon_flow.enter(self, int(best["tier"]))

## 阶段 10 的最小接线：研发一项可研发的科技 / 抽一次实验科技
## （阶段 11 会换成正经的科技树面板与四选一弹窗）
func research_next() -> String:
	for id in tech.available():
		if tech.can_unlock(id):
			if tech.unlock(id):
				_recompute_stats()
				print("[godot] 科技解锁：%s（剩余金币 %d）" % [id, int(tech.resources.get("gold", 0.0))])
				return id
	return ""


func roll_and_take_experiment(dir: String = "defense") -> String:
	var picked := tech.roll_options(world.rng, dir, experiments)
	if picked.is_empty():
		return ""
	var id: String = picked[0]
	experiments[id] = int(experiments.get(id, 0)) + 1
	_recompute_stats()
	print("[godot] 实验科技：%s Lv.%d（候选 %s）" % [id, int(experiments[id]), ",".join(picked)])
	return id


## 重算属性：角色基础 + 全部已解锁科技 + 全部已持有实验 + 装备（阶段 10）
func _recompute_stats() -> void:
	var chars: Dictionary = DataLoader.new().module("characters")
	var base: Dictionary = chars.get("CHAR_DEF", {}).get("engineer", {}).get("base", {})
	player_stats = StatSet.new(base)
	var effects: Array = []
	var tech_by_id := DataLoader.by_id(DataLoader.new().table("tech", "TECH_DEF", []))
	for id in tech.unlocked.keys():
		var node = tech_by_id.get(String(id), null)
		if node != null:
			effects.append(node.get("effect", {}))
	var exp_by_id := DataLoader.by_id(DataLoader.new().table("experiments", "EXPERIMENTS", []))
	for id in experiments.keys():
		var e = exp_by_id.get(String(id), null)
		if e != null:
			effects.append(StatSet.scale_effect(e.get("effect", {}), int(experiments[id])))
	# 开局那点起始加成也算进去（与之前一致）
	effects.append({ "damage": 0.15, "attackSpeed": 0.1, "rangeMult": 0.2, "projectiles": 1 })
	var folded := StatSet.fold_effects(effects)
	player_stats.add(folded["stats"])
	if player != null and player.loadout != null:
		player.stats = player_stats
		player.loadout.stats = player_stats
	if towers != null:
		towers.stats = player_stats

# =========================================================
#  阶段 11：暂停菜单与面板
# =========================================================

const TAB_NAMES := ["属性", "装备", "科技", "建造", "地图", "城镇", "实验", "行星", "系统", "副本", "制造", "设置", "图鉴"]

func toggle_pause() -> void:
	paused = not paused
	if paused:
		_refresh_panel()
	elif panel_root != null:
		panel_root.visible = false
	print("[godot] %s（Tab 切页签：%s）" % ["已暂停" if paused else "继续", "/".join(TAB_NAMES)])


func _refresh_panel() -> void:
	if panel_root != null:
		panel_root.queue_free()
		panel_root = null
	if not paused:
		return
	panel_root = Control.new()
	panel_root.name = "PanelRoot"
	panel_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	$UI.add_child(panel_root)
	var win := UiPanels.make_window("暂停 —— %s（Tab 切换 · Esc 关闭）" % TAB_NAMES[panel_tab], Vector2(880, 640))
	win.position = Vector2(200, 70)
	panel_root.add_child(win)
	var box: Node = win.get_node_or_null("Body")
	if box == null:
		return
	# 内容直接挂进 Body（不再套 ScrollContainer）。
	#
	# 试过 ScrollContainer，但它在 PanelContainer 里拿不到有效高度 ——
	# 结果是「节点都建好了、也 add_child 了，却一个都不显示」。
	# 面板改成**固定高度 + 每个区块限制行数**：长度可控、也不用跟滚动布局较劲。
	var body := VBoxContainer.new()
	body.name = "Content"
	box.add_child(body)
	match panel_tab:
		0:
			UiPanels.fill_rows(body, UiPanels.stat_rows(player_stats))
		1:
			_fill_inventory_full(body)
		2:
			_fill_tech(body)
		3:
			_fill_build(body)
		4:
			_fill_map(body)
		5:
			_fill_town(body)
		6:
			_fill_experiment(body)
		7:
			_fill_planet(body)
		8:
			_fill_system(body)
		9:
			_fill_dungeon_map(body)
		10:
			_fill_trade(body)
		11:
			_fill_settings(body)
		_:
			_fill_codex(body)


func _fill_inventory(body: Node) -> void:
	var slots := Label.new()
	slots.text = "装备槽：%s" % " / ".join(UiPanels.SLOT_NAMES)
	body.add_child(slots)
	var note := Label.new()
	note.text = "背包（按品质排序，与 DOM 版同一套比较规则）："
	note.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(note)
	# 演示物品：阶段 10 的掉落系统接上后会换成真实背包
	var bag: Array = []
	for i in 8:
		bag.append({ "id": "it%d" % i, "type": "armor" if i % 3 else "weapon",
			"slot": ["helmet", "chest", "legs", "trinket"][i % 4],
			"rarity": ["common", "rare", "epic", "relic"][i % 4],
			"name": "样品 %d" % i, "stats": { "armor": i * 2, "hpMax": i * 5 } })
	for it in UiPanels.sort_bag(bag, "rarity"):
		var line := Label.new()
		line.text = "%s（%s）" % [String(it["name"]), String(it["rarity"])]
		line.add_theme_color_override("font_color", UiPanels.RARITY_COLOR.get(String(it["rarity"]), Color.WHITE))
		body.add_child(line)


## 科技树：**图形化节点图**（分支分页 + 连线 + 状态着色），不是文字列表
func _fill_tech(body: Node) -> void:
	var head := Label.new()
	head.text = "已解锁 %d 项 · 可研发 %d 项 · 资源：%s" % [
		tech.unlocked.size(), tech.available().size(), _resource_line()]
	body.add_child(head)
	# 分支页签
	var tabs := HBoxContainer.new()
	var branch_names := {"defense": "防御工程", "weapon": "武器火力", "admin": "后勤管理",
		"explore": "探索", "bio": "生物", "vehicle": "载具工程"}
	if tech_view == null:
		tech_view = TechTreeView.new()
		tech_view.on_pick = func(id: String) -> void:
			if tech.unlock(id):
				_recompute_stats()
				print("[godot] 科技解锁：%s" % id)
				tech_view.unlocked = tech.unlocked
				tech_view.resources = tech.resources
				tech_view.queue_redraw()
				_refresh_panel()
	for b in tech_view.order:
		var bid := String(b)
		var btn := Button.new()
		btn.text = String(branch_names.get(bid, bid))
		btn.disabled = bid == tech_view.branch
		btn.pressed.connect(func() -> void:
			tech_view.branch = bid
			tech_view.relayout()
			tech_view.queue_redraw()
			_refresh_panel())
		tabs.add_child(btn)
	body.add_child(tabs)
	# 图区（可滚动：有些分支六列放不下）
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(820, 380)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	var canvas := Control.new()
	canvas.custom_minimum_size = tech_view.content_size()
	canvas.draw.connect(func() -> void:
		tech_view.draw_into(canvas))
	canvas.gui_input.connect(func(ev: InputEvent) -> void:
		tech_view._gui_input(ev)
		if tech_view.focused != "":
			_refresh_panel())
	scroll.add_child(canvas)
	tech_view.setup(_tech_map(), tech.unlocked, tech.resources,
		String(start_params_static.get("character", "engineer")))
	tech_view.queue_redraw()
	body.add_child(scroll)
	# 选中节点的详情
	if tech_view.focused != "":
		var def := tech.tech_def(tech_view.focused)
		var d1 := Label.new()
		d1.text = "%s —— %s" % [String(def.get("name", tech_view.focused)),
			String(def.get("desc", ""))]
		d1.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		d1.custom_minimum_size = Vector2(800, 0)
		d1.add_theme_color_override("font_color", Color("#8fe0ff"))
		body.add_child(d1)
	var hint := Label.new()
	hint.text = "点节点看详情；「＋」的节点点一下就能研发（缺资源会显示缺多少）。"
	hint.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(hint)


func _tech_map() -> Dictionary:
	return DataLoader.by_id(DataLoader.new().table("tech", "TECH_DEF", []))


func _resource_line() -> String:
	var parts: Array = []
	for k in ["gold", "metal", "crystal", "parts", "research"]:
		var v := int(float(tech.resources.get(k, 0.0)))
		if v > 0:
			parts.append("%s %d" % [Names.resource(String(k)), v])
	return " · ".join(parts) if not parts.is_empty() else "—"

func _materials_text() -> String:
	if props_layer == null:
		return "-"
	var parts: Array = []
	for k in props_layer.resources.keys():
		parts.append("%s %d" % [Names.resource(String(k)), int(props_layer.resources[k])])
	if parts.is_empty():
		return "（按住 E 采集）"
	return " · ".join(parts)

## 建造面板：列出可空投的塔与可铺的建筑（造价 + 「基座免间隔」提示）
func _fill_build(body: Node) -> void:
	var defs: Dictionary = DataLoader.new().table("towers", "TOWER_DEF", {})
	var sdefs: Dictionary = DataLoader.new().table("towers", "STRUCTURE_DEF", {})
	var head := Label.new()
	# 中文塔名 + 与当前按键表一致的提示（按键改成原版方案后，旧提示「1 铺基座」已经不对了）
	head.text = "当前选中：%s · 塔 %d/%d · 点「建造 →」进放置模式，鼠标左键落位、右键或 B 取消" % [
		Names.tower(towers.selected), towers.count(), TowerMath.tower_cap(player_stats)]
	body.add_child(head)
	var hint := Label.new()
	hint.text = "空地上的塔彼此要留间隔（44px）；放在【防御塔基座】上则免间隔 —— 可以一座挨一座。"
	hint.add_theme_color_override("font_color", Color("#6ee7a8"))
	body.add_child(hint)
	var t_head := Label.new()
	t_head.text = "— 防御塔 —"
	t_head.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(t_head)
	for id in defs.keys():
		var d: Dictionary = defs[id]
		var row := HBoxContainer.new()
		var name_l := Label.new()
		# 只显示中文名：原来后面还挂着英文 id，玩家看到的是一串代号
		# 图标 + 中文名：建造面板要能「看图标认塔」，不是一列纯文字
		var tex := Sprites.tower_tex(String(id))
		if tex != null:
			var icon := TextureRect.new()
			icon.texture = tex
			icon.custom_minimum_size = Vector2(40, 40)
			icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			row.add_child(icon)
		name_l.text = Names.tower(String(id))
		name_l.custom_minimum_size = Vector2(220, 0)
		var cost := TowerMath.scale_cost(d.get("cost", {}), 1.0 + player_stats.stat("buildCostMult"))
		var parts: Array = []
		for k in cost.keys():
			parts.append("%s %d" % [Names.resource(String(k)), int(cost[k])])
		var cost_l := Label.new()
		cost_l.text = " · ".join(parts)
		var btn := Button.new()
		btn.text = "建造 →"
		var id_c := String(id)
		btn.pressed.connect(func() -> void:
			_begin_placement(id_c))
		row.add_child(name_l)
		row.add_child(cost_l)
		row.add_child(btn)
		body.add_child(row)
	var s_head := Label.new()
	s_head.text = "— 建筑 —"
	s_head.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(s_head)
	for id in sdefs.keys():
		var d2: Dictionary = sdefs[id]
		var line := Label.new()
		var cost2 := TowerMath.scale_cost(d2.get("cost", {}), 1.0 + player_stats.stat("buildCostMult"))
		var parts2: Array = []
		for k in cost2.keys():
			parts2.append("%s %d" % [Names.resource(String(k)), int(cost2[k])])
		line.text = "%s —— %s" % [Names.structure(String(id)), " · ".join(parts2)]
		body.add_child(line)


## 世界地图面板：地形缩略图 + 巢穴/地标/玩家标记；副本里改画鱼骨布局
func _fill_map(body: Node) -> void:
	var tex := TextureRect.new()
	tex.texture = _map_texture()
	tex.custom_minimum_size = Vector2(420, 420)
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	body.add_child(tex)
	var info := Label.new()
	if world.dungeon != null:
		var d: Dictionary = world.dungeon
		info.text = "虫巢副本 T%d —— 入口 (%d,%d) · Boss (%d,%d) · 侧室 %d 间" % [
			int(d["tier"]), int(d["entry"]["tx"]), int(d["entry"]["ty"]),
			int(d["boss"]["tx"]), int(d["boss"]["ty"]), (d["chambers"] as Array).size()]
	else:
		info.text = "地表 —— 巢穴 %d 个（最近 %.0fm）· 地标 %d 个 · 玩家 (%d,%d)" % [
			_nest_count(), _nearest_nest_dist() / 40.0, world.pois.size(),
			int(player.position.x), int(player.position.y)]
	body.add_child(info)


func _nest_count() -> int:
	var n := 0
	for nest in world.nests:
		if not GdMath.truthy(nest.get("destroyed", false)):
			n += 1
	return n


func _nearest_nest_dist() -> float:
	var best := 1.0e18
	for nest in world.nests:
		if GdMath.truthy(nest.get("destroyed", false)):
			continue
		best = minf(best, GdMath.dist(player.position.x, player.position.y, float(nest["x"]), float(nest["y"])))
	return 0.0 if best == 1.0e18 else best


func _map_texture() -> ImageTexture:
	var img := Image.create(Cfg.WORLD_TILES, Cfg.WORLD_TILES, false, Image.FORMAT_RGBA8)
	var defs: Dictionary = DataLoader.new().table("tiles", "TILE_DEF", {})
	for ty in Cfg.WORLD_TILES:
		for tx in Cfg.WORLD_TILES:
			var t: int = world.tiles[ty * Cfg.WORLD_TILES + tx]
			var d = defs.get(str(t), defs.get(t, null))
			var c := Color(0.02, 0.03, 0.05)
			if d is Dictionary and d.has("color"):
				c = Color(String(d["color"]))
			img.set_pixel(tx, ty, c.darkened(float(world.variant[ty * Cfg.WORLD_TILES + tx]) / 255.0 * 0.12))
	# 巢穴红点 / 地标黄点 / 玩家白点
	for nest in world.nests:
		if GdMath.truthy(nest.get("destroyed", false)):
			continue
		_dot(img, float(nest["x"]), float(nest["y"]), Color("#ff5f6d"))
	for poi in world.pois:
		_dot(img, float(poi["x"]), float(poi["y"]), Color("#ffba4c"))
	_dot(img, player.position.x, player.position.y, Color.WHITE)
	return ImageTexture.create_from_image(img)


func _dot(img: Image, x: float, y: float, color: Color) -> void:
	var tx := int(x / float(Cfg.TILE))
	var ty := int(y / float(Cfg.TILE))
	if tx < 1 or ty < 1 or tx >= Cfg.WORLD_TILES - 1 or ty >= Cfg.WORLD_TILES - 1:
		return
	img.set_pixel(tx, ty, color)
	img.set_pixel(tx - 1, ty, color)
	img.set_pixel(tx + 1, ty, color)
	img.set_pixel(tx, ty - 1, color)
	img.set_pixel(tx, ty + 1, color)

## 实机存/读档往返：改几个关键值 → 存 → 再改回去 → 读 → 打印比对结果
func _auto_saveload_test() -> void:
	var before := {
		"x": int(player.position.x), "hp": int(player.hp),
		"fiber": int(props_layer.resources.get("fiber", 0)),
		"tech": tech.unlocked.size(), "wave": director.wave_number,
		"baseR": int(towers.bases[0].get("r", 0.0)) if not towers.bases.is_empty() else -1,
	}
	# 先造点状态出来
	tech.resources["gold"] = 2400.0
	research_next()
	research_next()
	props_layer.resources["fiber"] = 33
	player.hp = 88.0
	director.wave_number = 7
	SaveGame.save(self, "slot1")
	# 全部改乱
	player.hp = 1.0
	props_layer.resources["fiber"] = 0
	director.wave_number = 0
	player.position = Vector2(0, 0)
	var ok := SaveGame.restore(self, SaveGame.load_data("slot1"))
	var after := {
		"x": int(player.position.x), "hp": int(player.hp),
		"fiber": int(props_layer.resources.get("fiber", 0)),
		"tech": tech.unlocked.size(), "wave": director.wave_number,
		"baseR": int(towers.bases[0].get("r", 0.0)) if not towers.bases.is_empty() else -1,
	}
	print("[godot] 存档往返：%s → 读回 hp %d · fiber %d · wave %d · 科技 %d 项 · base.r %d" % [
		"成功" if ok else "失败", after["hp"], after["fiber"], after["wave"], after["tech"], after["baseR"]])
	print("[godot] 存档往返比对：hp %d→%d · fiber %s→%s · 槽位 %s" % [
		before["hp"], after["hp"],
		str(props_layer.resources.get("fiber", 0)), str(after["fiber"]),
		",".join(SaveGame.list_slots())])

## 城镇面板：人口/档位/岗位 + 可建建筑（造价与解锁）+ 生产总览
func _fill_town(body: Node) -> void:
	var tier := town.tier_for(town.population)
	var head := Label.new()
	head.text = "人口 %d/%d · %s · 空闲 %d · 食物 %.0f" % [
		town.population, town.pop_cap(), String(tier.get("name", "?")), town.idle_pop(),
		float(town.resources.get("food", 0.0))]
	body.add_child(head)
	var prod := town.production_summary()
	var parts: Array = []
	for k in prod.keys():
		parts.append("%s +%.2f/s" % [String(k), float(prod[k])])
	var pl := Label.new()
	pl.text = "生产：%s" % (" · ".join(parts) if not parts.is_empty() else "（还没有工人在岗）")
	pl.add_theme_color_override("font_color", Color("#6ee7a8"))
	body.add_child(pl)
	var bh := Label.new()
	bh.text = "— 已建成 %d 座 —" % town.buildings.size()
	bh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(bh)
	for b in town.buildings:
		var d := town.def_of(String(b["type"]))
		var line := Label.new()
		line.text = "%s（工人 %d/%d）" % [Names.structure(String(b["type"])), int(b["workers"]),
			int(d.get("jobs", 0))]
		body.add_child(line)
	var ch := Label.new()
	ch.text = "— 可建造 —"
	ch.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(ch)
	for type in town._defs.keys():
		var def: Dictionary = town._defs[type]
		var unlocked := town.is_unlocked(String(type))
		var row := HBoxContainer.new()
		var name_l := Label.new()
		name_l.text = "%s%s" % [String(def.get("name", type)), "" if unlocked else "（未解锁）"]
		name_l.custom_minimum_size = Vector2(200, 0)
		if not unlocked:
			name_l.add_theme_color_override("font_color", Color("#6b7684"))
		var cost: Dictionary = def.get("cost", {})
		var cost_parts: Array = []
		for k in cost.keys():
			cost_parts.append("%s %d" % [Names.resource(String(k)), int(float(cost[k]))])
		var cost_l := Label.new()
		cost_l.text = " · ".join(cost_parts)
		var btn := Button.new()
		btn.text = "建造"
		btn.disabled = not unlocked
		var type_c := String(type)
		btn.pressed.connect(func() -> void: _place_town_building(type_c))
		row.add_child(name_l)
		row.add_child(cost_l)
		row.add_child(btn)
		body.add_child(row)


## 在基地旁边找块空地盖（城镇建筑必须建在基地范围内）
func _place_town_building(type: String) -> void:
	var base: Dictionary = towers.bases[0] if not towers.bases.is_empty() else {
		"x": player.position.x, "y": player.position.y, "buildRadius": 520.0 }
	var a := randf() * TAU
	var want := Vector2(float(base["x"]) + cos(a) * 120.0, float(base["y"]) + sin(a) * 120.0)
	var spot := world.find_open_spot(want.x, want.y, 200.0)
	var b := town.place_building(type, float(spot["x"]), float(spot["y"]))
	if b.is_empty():
		print("[godot] 建不了 %s（未解锁或资源不足）" % type)
	else:
		print("[godot] 城镇建筑落成：%s（人口上限 %d）" % [type, town.pop_cap()])
	_refresh_panel()


## 实验科技面板：三方向 → 四选一
var exp_dir := "defense"
var exp_options: Array = []


func _fill_experiment(body: Node) -> void:
	var head := Label.new()
	head.text = "已持有 %d 张 · 当前候选 %d 张" % [experiments.size(), exp_options.size()]
	body.add_child(head)
	var row := HBoxContainer.new()
	for dir in ["admin", "defense", "explore"]:
		var btn := Button.new()
		btn.text = {"admin": "后勤", "defense": "防御", "explore": "探索"}[dir]
		var dir_c := String(dir)
		btn.pressed.connect(func() -> void:
			exp_dir = dir_c
			exp_options = tech.roll_options(world.rng, dir_c, experiments)
			_refresh_panel())
		row.add_child(btn)
	body.add_child(row)
	var dir_l := Label.new()
	dir_l.text = "方向：%s —— 点方向按钮抽 4 张候选" % exp_dir
	dir_l.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(dir_l)
	for id in exp_options:
		var def: Dictionary = {}
		for e in tech._experiments():
			if String(e["id"]) == String(id):
				def = e
				break
		var b := Button.new()
		b.text = "%s（%s · Lv.%d）—— %s" % [Names.experiment(String(id)), Names.rarity(String(def.get("rarity", ""))),
			int(experiments.get(String(id), 0)), String(def.get("desc", ""))]
		var id_c := String(id)
		b.pressed.connect(func() -> void:
			if tech.take_experiment(id_c, experiments):
				_recompute_stats()
				print("[godot] 实验科技：%s Lv.%d" % [id_c, int(experiments.get(id_c, 0))])
				exp_options = []
				_refresh_panel())
		body.add_child(b)
	var lh := Label.new()
	lh.text = "— 已持有 —"
	lh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(lh)
	for id in experiments.keys():
		var l := Label.new()
		l.text = "%s Lv.%d" % [String(id), int(experiments[id])]
		body.add_child(l)


# =========================================================
#  阶段 11 第三批：行星 / 系统 / 行动栏 / Steam
# =========================================================

## 行星面板：12 个行星的名字与后缀、当前所在、已占领标记
func _fill_planet(body: Node) -> void:
	var mod: Dictionary = DataLoader.new().module("planets")
	var names: Array = mod.get("PLANET_NAMES", [])
	var suffix: Array = mod.get("PLANET_SUFFIX", [])
	var head := Label.new()
	head.text = "当前：第 %d 号行星 %s · 已占领 %d 个" % [
		world.planet_index + 1, planet_label(world.planet_index), claimed_planets.size()]
	body.add_child(head)
	var hint := Label.new()
	hint.text = "按 G 切换下一个行星（会重新生成世界）—— 每颗星球的地形、怪种、资源都不同。"
	hint.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(hint)
	for i in mini(names.size(), 12):
		var row := HBoxContainer.new()
		var l := Label.new()
		var mark := "▶ " if i == world.planet_index else "   "
		l.text = "%s%2d. %s" % [mark, i + 1, planet_label(i)]
		l.custom_minimum_size = Vector2(260, 0)
		if claimed_planets.has(i):
			l.add_theme_color_override("font_color", Color("#6ee7a8"))
		row.add_child(l)
		var btn := Button.new()
		btn.text = "前往" if i != world.planet_index else "当前"
		btn.disabled = (i == world.planet_index)
		var idx := i
		btn.pressed.connect(func() -> void: _travel_to_planet(idx))
		row.add_child(btn)
		body.add_child(row)
	var suffix_l := Label.new()
	var parts: Array = []
	for s in suffix:
		parts.append(String(s))
	suffix_l.text = "星球风貌：" + " · ".join(parts)
	suffix_l.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(suffix_l)


func planet_label(idx: int) -> String:
	var mod: Dictionary = DataLoader.new().module("planets")
	var names: Array = mod.get("PLANET_NAMES", [])
	var suffix: Array = mod.get("PLANET_SUFFIX", [])
	var n := String(names[idx % maxi(1, names.size())]) if not names.is_empty() else "未知"
	var s := String(suffix[idx % maxi(1, suffix.size())]) if not suffix.is_empty() else ""
	return "%s·%s" % [n, s] if s != "" else n


## 换星球：重新生成世界并重挂所有系统（阶段 11 的简化版 —— 不走登录流程）
func _rebuild_world(idx: int) -> void:
	planet_index_next = idx
	print("[godot] 世界重建交给下一次启动（用 --planet=%d）" % idx)
	get_tree().quit()


var planet_index_next := 0


func _travel_to_planet(idx: int) -> void:
	if idx == world.planet_index:
		return
	print("[godot] 前往 %s（阶段 11 的简化版：直接换星球索引并重生世界）" % planet_label(idx))
	claimed_planets[world.planet_index] = true
	paused = false
	_rebuild_world(idx)


var claimed_planets: Dictionary = {}


## 系统面板：存档槽位 / 设置开关 / 常用快捷键
func _fill_system(body: Node) -> void:
	var head := Label.new()
	head.text = "存档槽位（F5 存 · F9 读）：%s" % (
		", ".join(SaveGame.list_slots()) if not SaveGame.list_slots().is_empty() else "（还没有存档）")
	body.add_child(head)
	var row := HBoxContainer.new()
	for slot in ["slot1", "slot2", "slot3"]:
		var b1 := Button.new()
		b1.text = "存到 %s" % slot
		var slot_c := String(slot)
		b1.pressed.connect(func() -> void:
			if SaveGame.save(self, slot_c):
				print("[godot] 存档已写入 %s" % slot_c)
			_refresh_panel())
		var b2 := Button.new()
		b2.text = "读取 %s" % slot
		b2.pressed.connect(func() -> void:
			if SaveGame.restore(self, SaveGame.load_data(slot_c)):
				print("[godot] 存档已读回 %s" % slot_c)
			else:
				print("[godot] %s 没有存档" % slot_c)
			_refresh_panel())
		row.add_child(b1)
		row.add_child(b2)
	body.add_child(row)

	var sh := Label.new()
	sh.text = "— 设置（即时生效，自动保存到 user://settings.json）—"
	sh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(sh)
	for pair in [["masterVolume", "主音量"], ["musicVolume", "音乐"], ["sfxVolume", "音效"]]:
		var key := String(pair[0])
		var line := HBoxContainer.new()
		var l := Label.new()
		l.text = String(pair[1])
		l.custom_minimum_size = Vector2(120, 0)
		var slider := HSlider.new()
		slider.min_value = 0.0
		slider.max_value = 1.0
		slider.step = 0.05
		slider.value = float(settings.get_value(key))
		slider.custom_minimum_size = Vector2(220, 0)
		slider.value_changed.connect(func(v: float) -> void:
			settings.set_value(key, v)
			settings.apply(get_tree())
			settings.save())
		line.add_child(l)
		line.add_child(slider)
		body.add_child(line)
	for pair in [["fullscreen", "全屏"], ["showFps", "显示帧率"], ["showMinimap", "显示小地图"]]:
		var key2 := String(pair[0])
		var line2 := HBoxContainer.new()
		var cb := CheckBox.new()
		cb.text = String(pair[1])
		cb.button_pressed = GdMath.truthy(settings.get_value(key2))
		cb.toggled.connect(func(on: bool) -> void:
			settings.set_value(key2, on)
			settings.apply(get_tree(), key2 == "fullscreen")
			settings.save())
		line2.add_child(cb)
		body.add_child(line2)

	var kh := Label.new()
	kh.text = "— 快捷键 —"
	kh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(kh)
	var keys := Label.new()
	keys.text = "WASD 移动 · Shift 冲刺 · 左键开火 · R 换弹 · E 采集 · 1 铺基座 · 2 空投塔 · F 进/出副本 · N 撒怪 · F5/F9 存读档 · Esc 暂停 · Tab 切页签"
	body.add_child(keys)
	var qrow := HBoxContainer.new()
	var quit := Button.new()
	quit.text = "退出到桌面"
	quit.pressed.connect(func() -> void: get_tree().quit())
	qrow.add_child(quit)
	body.add_child(qrow)


## 行动栏（常驻 HUD）：把最常用的几个键做成一行提示，不用开面板也看得见
func _build_action_bar() -> void:
	var bar := PanelContainer.new()
	bar.name = "ActionBar"
	bar.position = Vector2(150, 668)
	bar.custom_minimum_size = Vector2(1020, 34)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.06, 0.08, 0.12, 0.78)
	style.border_color = Color(0.35, 0.45, 0.58, 0.6)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	bar.add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	bar.add_child(row)
	# 按键提示必须与**原版按键表**一致：之前这里写着「1/2 基座/塔」「N 撒怪」，
	# 那是移植早期我自己编的键位，原版根本没有 —— 玩家一眼就看出不对。
	for pair in [["WASD", "移动"], ["Shift", "冲刺"], ["Space", "闪避"], ["E", "采集/维修"],
		["F", "上车/进虫巢/遗迹"], ["B", "建造"], ["T", "科技"], ["G", "城镇"],
		["Tab", "背包"], ["M", "地图"], ["Esc", "面板"]]:
		var l := Label.new()
		l.text = "[%s] %s" % [String(pair[0]), String(pair[1])]
		l.add_theme_font_size_override("font_size", 13)
		l.add_theme_color_override("font_color", Color("#c9d4e0"))
		row.add_child(l)
		var sep := Label.new()
		sep.text = "   "
		row.add_child(sep)
	$UI.add_child(bar)


# =========================================================
#  副本地图面板（对应 JS 的 panelDungeonMap）
# =========================================================

## 把副本画成「鱼骨」示意图：一条主通道、挂着侧室、尽头是 Boss 房，
## 再叠上玩家与巢穴主的位置。数据全部来自 Dungeon.carve 写进 world.dungeon 的那份。
func _fill_dungeon_map(body: Node) -> void:
	if world.dungeon == null:
		var l := Label.new()
		l.text = "当前在地表 —— 进虫巢副本后这里会显示副本结构。"
		l.add_theme_color_override("font_color", Color("#8ba0bb"))
		body.add_child(l)
		return
	var d: Dictionary = world.dungeon
	var region: Dictionary = d["region"]
	var entry: Dictionary = d["entry"]
	var boss: Dictionary = d["boss"]
	var chambers: Array = d["chambers"]
	var head := Label.new()
	head.text = "虫巢副本 T%d · 区域 %d×%d · 入口 (%d,%d) · 巢穴主 (%d,%d) · 侧室 %d 间" % [
		int(d["tier"]), int(region["w"]), int(region["h"]),
		int(entry["tx"]), int(entry["ty"]), int(boss["tx"]), int(boss["ty"]), chambers.size()]
	body.add_child(head)
	var tex := TextureRect.new()
	tex.texture = _dungeon_texture()
	tex.custom_minimum_size = Vector2(560, 260)
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	body.add_child(tex)
	# 侧室清单（第几间、坐标、离入口多远）
	for i in chambers.size():
		var c: Dictionary = chambers[i]
		var line := Label.new()
		line.text = "侧室 %d：(%d,%d) —— 离入口 %.0f 格" % [i + 1, int(c["tx"]), int(c["ty"]),
			GdMath.dist(float(c["x"]), float(c["y"]), float(entry["x"]), float(entry["y"])) / float(Cfg.TILE)]
		body.add_child(line)


## 烘一张副本示意图：巢壁黑、巢道暗红、巢核亮红，入口绿点、Boss 房红圈、玩家白点
func _dungeon_texture() -> ImageTexture:
	var d: Dictionary = world.dungeon
	var region: Dictionary = d["region"]
	var rw := int(region["w"])
	var rh := int(region["h"])
	var x0 := int(region["x0"])
	var y0 := int(region["y0"])
	var img := Image.create(rw, rh, false, Image.FORMAT_RGBA8)
	for y in rh:
		for x in rw:
			var t: int = world.tiles[(y + y0) * Cfg.WORLD_TILES + (x + x0)]
			var c := Color(0.04, 0.03, 0.05)
			if t == Cfg.T_NEST_FLOOR:
				c = Color(0.36, 0.15, 0.22)
			elif t == Cfg.T_NEST_ORGAN:
				c = Color(0.62, 0.24, 0.32)
			img.set_pixel(x, y, c)
	var mark := func(tx: int, ty: int, color: Color, size: int) -> void:
		for dy in range(-size, size + 1):
			for dx in range(-size, size + 1):
				var px := tx - x0 + dx
				var py := ty - y0 + dy
				if px >= 0 and py >= 0 and px < rw and py < rh:
					img.set_pixel(px, py, color)
	mark.call(int(d["entry"]["tx"]), int(d["entry"]["ty"]), Color("#6ee7a8"), 2)
	mark.call(int(d["boss"]["tx"]), int(d["boss"]["ty"]), Color("#ff5f6d"), 3)
	for c2 in d["chambers"]:
		mark.call(int(c2["tx"]), int(c2["ty"]), Color("#ffba4c"), 1)
	mark.call(int(player.position.x / float(Cfg.TILE)), int(player.position.y / float(Cfg.TILE)),
		Color.WHITE, 1)
	return ImageTexture.create_from_image(img)


# =========================================================
#  主菜单（阶段 11：让游戏从启动界面开始）
# =========================================================

## 从截图参数直接开局时，把「进副本」也一并处理（省得再按一次键）
func _auto_start_dungeon_if_needed() -> void:
	if auto_dungeon == 1 and _shot_frame == 0:
		call_deferred("_enter_nearest_nest")


func _show_main_menu() -> void:
	menu = MainMenu.new()   # 旧入口，仅测试用
	if not start_params_static.is_empty():
		menu.select_mode(String(start_params_static.get("mode", "frontier")))
		menu.select_character(String(start_params_static.get("character", "engineer")))
	menu.build_ui($UI, Callable(self, "_on_menu_start"), Callable(self, "_on_menu_continue"))
	print("[godot] 主菜单：模式 %s · 角色 %s · 种子 %s" % [menu.mode, menu.character, menu.seed_text])


func _on_menu_start(params: Dictionary) -> void:
	start_params_static = params
	print("[godot] 开始游戏：模式 %s · 角色 %s · 种子 %s · 巢穴密度 %.1f · 阵地半径 %.0f" % [
		String(params["mode"]), String(params["character"]), String(params["seed"]),
		float(params["nestScale"]), float(params["fieldRadius"])])
	get_tree().reload_current_scene()


func _on_menu_continue() -> void:
	start_params_static = {}
	print("[godot] 继续上次存档")
	get_tree().reload_current_scene()

# =========================================================
#  HUD 视图（阶段 11：把调试文本变成正经抬头显示）
# =========================================================

var hud_root: Control = null
var hud_hp_bar: ProgressBar = null
var hud_hp_label: Label = null
var hud_left: Label = null
var hud_right: Label = null
var hud_wave: Label = null
var hud_boss: ProgressBar = null
var hud_boss_label: Label = null


func _build_hud() -> void:
	hud_root = Control.new()
	hud_root.name = "Hud"
	hud_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	$UI.add_child(hud_root)

	# 左上：生命条 + 弹药
	var box := VBoxContainer.new()
	box.position = Vector2(14, 10)
	box.custom_minimum_size = Vector2(320, 0)
	hud_root.add_child(box)
	hud_hp_bar = ProgressBar.new()
	hud_hp_bar.custom_minimum_size = Vector2(260, 16)
	hud_hp_bar.show_percentage = false
	hud_hp_bar.max_value = 1.0
	box.add_child(hud_hp_bar)
	hud_hp_label = Label.new()
	hud_hp_label.add_theme_font_size_override("font_size", 14)
	box.add_child(hud_hp_label)
	hud_left = Label.new()
	hud_left.add_theme_font_size_override("font_size", 14)
	box.add_child(hud_left)

	# 顶部中间：波次状态
	hud_wave = Label.new()
	hud_wave.position = Vector2(460, 12)
	hud_wave.custom_minimum_size = Vector2(360, 0)
	hud_wave.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud_wave.add_theme_font_size_override("font_size", 16)
	hud_root.add_child(hud_wave)

	# 右上：地点与资源
	# 固定放在右上角：窗口是固定 1280×720，用绝对坐标比 anchor 组合更不容易出错
	# （之前用 PRESET_TOP_RIGHT + position(-420,10)，在加入场景树前设 anchor 没生效，整块看不见）
	hud_right = Label.new()
	hud_right.position = Vector2(850, 10)
	hud_right.custom_minimum_size = Vector2(400, 0)
	hud_right.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud_right.add_theme_font_size_override("font_size", 13)
	hud_root.add_child(hud_right)

	# 底部中间偏上：Boss 血条（平时隐藏）
	var boss_box := VBoxContainer.new()
	boss_box.position = Vector2(380, 600)
	boss_box.custom_minimum_size = Vector2(520, 0)
	hud_root.add_child(boss_box)
	hud_boss_label = Label.new()
	hud_boss_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud_boss_label.add_theme_font_size_override("font_size", 15)
	boss_box.add_child(hud_boss_label)
	hud_boss = ProgressBar.new()
	hud_boss.custom_minimum_size = Vector2(520, 18)
	hud_boss.show_percentage = false
	hud_boss.max_value = 1.0
	boss_box.add_child(hud_boss)


func _update_hud() -> void:
	if hud_root == null:
		return
	var frac := HudModel.hp_fraction(player.hp, player.hp_max)
	hud_hp_bar.value = frac
	var style := StyleBoxFlat.new()
	style.bg_color = HudModel.hp_color(frac)
	style.set_corner_radius_all(3)
	hud_hp_bar.add_theme_stylebox_override("fill", style)
	hud_hp_label.text = "生命 %s%s" % [HudModel.hp_text(player.hp, player.hp_max),
		"（无敌 %.1fs）" % player.invuln if player.invuln > 0.0 else ""]
	var reloading: bool = player.loadout != null and GdMath.truthy(player.loadout.reloading)
	var progress: float = player.loadout.reload_progress() if reloading else 0.0
	hud_left.text = "弹药 %s · %s" % [HudModel.ammo_text(
		player.loadout.ammo if player.loadout != null else 0,
		player.loadout.ammo_max if player.loadout != null else 0, reloading, progress),
		HudModel.vehicle_text(vehicle.mounted, vehicle.fuel, Vehicle.FUEL_MAX, vehicle.hp, vehicle.hp_max)]
	hud_wave.text = HudModel.wave_text(director.state, director.timer, director.wave_number,
		director.remaining, director.total, director.hunt_mode)
	hud_wave.add_theme_color_override("font_color", HudModel.wave_color(director.state, director.hunt_mode))
	var biome_name := ""
	var biome_defs: Dictionary = DataLoader.new().table("tiles", "BIOME_DEF", {})
	var bkey := str(world.biomes[int(player.position.y / float(Cfg.TILE)) * Cfg.WORLD_TILES
		+ int(player.position.x / float(Cfg.TILE))])
	if biome_defs.has(bkey):
		biome_name = String((biome_defs[bkey] as Dictionary).get("name", bkey))
	hud_right.text = "%s\n%s · %s" % [
		HudModel.place_text(world.dungeon, biome_name,
			int(player.position.x / float(Cfg.TILE)), int(player.position.y / float(Cfg.TILE)),
			world.planet_index + 1),
		HudModel.beacon_text(director.beacon_fuel, director.beacon_fuel_max(), director.beacon_online,
			director.beacon_level),
		HudModel.resource_text(props_layer.resources)]
	var boss_title := HudModel.boss_bar_title(enemies.enemies)
	hud_boss_label.text = boss_title
	hud_boss.value = HudModel.boss_bar_fraction(enemies.enemies)
	hud_boss_label.visible = boss_title != ""
	hud_boss.visible = boss_title != ""


# =========================================================
#  贸易站 / 制造面板（对应 JS 的 panelTown 制造区）
# =========================================================

var craft_rarity := "common"
var craft_filter := "weapon"      # weapon / armor


func _fill_trade(body: Node) -> void:
	var tier := crafting.craft_tier(town.town_tier)
	var has_workshop := false
	for b in town.buildings:
		if String(b["type"]) == "workshop":
			has_workshop = true
	var head := Label.new()
	head.text = "制造等级：%s · 可造上限：%s色 · 人口 %d（城镇 %s）" % [
		String(tier.get("name", "?")), Names.rarity_color_name(String(tier.get("rarity", "common"))),
		town.population, String(town.tier_for(town.population).get("name", "?"))]
	body.add_child(head)
	var hint := Label.new()
	hint.text = "城镇最高只能造到紫色 —— 红色只能靠打。造装备需要先建【军械工坊】。"
	hint.add_theme_color_override("font_color", Color("#ffba4c"))
	body.add_child(hint)
	if not has_workshop:
		var warn := Label.new()
		warn.text = "（还没有军械工坊：到「城镇」页签里建一座）"
		warn.add_theme_color_override("font_color", Color("#ff5f6d"))
		body.add_child(warn)

	# 品质选择：能造哪些品质由制造等级决定
	var rrow := HBoxContainer.new()
	for r in ["common", "uncommon", "rare", "epic"]:
		var b := Button.new()
		b.text = "%s（%s）" % [Names.rarity(String(r)), Names.rarity_color_name(String(r))]
		b.disabled = not crafting.can_craft_rarity(String(r), town.town_tier) or String(r) == craft_rarity
		if not crafting.can_craft_rarity(String(r), town.town_tier):
			b.tooltip_text = "还没到这一档（需要更高的城镇等级）"
		var r_c := String(r)
		b.pressed.connect(func() -> void:
			craft_rarity = r_c
			_refresh_panel())
		rrow.add_child(b)
	body.add_child(rrow)
	# 分类
	var frow := HBoxContainer.new()
	for f in [["weapon", "武器"], ["armor", "护甲"]]:
		var b2 := Button.new()
		b2.text = String(f[1])
		b2.disabled = String(f[0]) == craft_filter
		var f_c := String(f[0])
		b2.pressed.connect(func() -> void:
			craft_filter = f_c
			_refresh_panel())
		frow.add_child(b2)
	body.add_child(frow)

	var list: Array = crafting.craftable_weapons(town.town_tier) if craft_filter == "weapon" \
		else crafting.craftable_armor(town.town_tier)
	var lh := Label.new()
	lh.text = "— 可制造 %d 件（造价按品质与档位折算）—" % list.size()
	lh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(lh)
	var shown := 0
	for entry in list:
		if shown >= 10:
			break
		shown += 1
		var cost := crafting.craft_cost(entry, craft_rarity, town.town_tier)
		var row := HBoxContainer.new()
		var name_l := Label.new()
		name_l.text = String(entry.get("name", entry.get("id", "?")))
		name_l.custom_minimum_size = Vector2(180, 0)
		name_l.add_theme_color_override("font_color",
			UiPanels.RARITY_COLOR.get(craft_rarity, Color.WHITE))
		var cost_l := Label.new()
		var parts: Array = []
		for k in cost.keys():
			parts.append("%s %d" % [Names.resource(String(k)), int(cost[k])])
		cost_l.text = " · ".join(parts)
		cost_l.custom_minimum_size = Vector2(260, 0)
		var btn := Button.new()
		btn.text = "制造"
		btn.disabled = not has_workshop or not crafting.can_craft_rarity(craft_rarity, town.town_tier)
		var e_c: Dictionary = entry
		btn.pressed.connect(func() -> void: _craft_item(e_c))
		row.add_child(name_l)
		row.add_child(cost_l)
		row.add_child(btn)
		body.add_child(row)


## 造一件：先付材料（城镇资源里扣），再进快捷栏或背包
func _craft_item(entry: Dictionary) -> void:
	var cost := crafting.craft_cost(entry, craft_rarity, town.town_tier)
	for k in cost.keys():
		if float(town.resources.get(String(k), 0.0)) < float(cost[k]):
			print("[godot] 材料不够：%s 需要 %s %d" % [String(entry.get("name", "?")), k, int(cost[k])])
			return
	for k in cost.keys():
		town.resources[k] = float(town.resources.get(String(k), 0.0)) - float(cost[k])
	var item := {
		"id": String(entry.get("id", "")),
		"type": "weapon" if String(entry.get("kind", "")) == "weapon" else "armor",
		"slot": String(entry.get("slot", "")) if String(entry.get("kind", "")) != "weapon" else "",
		"name": String(entry.get("name", entry.get("id", ""))),
		"rarity": craft_rarity,
	}
	var res := hotbar.add_item(item)
	print("[godot] 制造完成：%s（%s）→ %s" % [String(item["name"]), craft_rarity, res])
	_refresh_panel()


## 把当前局势喂给 Steam 桥推导成就（每 2 秒一次，够用且不费）
func _check_achievements() -> void:
	if steam == null:
		return
	var nests_total := world.nests.size()
	var nests_cleared := 0
	for nest in world.nests:
		if GdMath.truthy(nest.get("destroyed", false)):
			nests_cleared += 1
	var has_relic := false
	for w in hotbar.weapons:
		if String(w.get("rarity", "")) == "relic":
			has_relic = true
	var boss_killed := false
	for e in enemies.enemies:
		if GdMath.truthy(e.get("dungeonBoss", false)) and GdMath.truthy(e.get("dead", false)):
			boss_killed = true
	var newly := steam.check_from_state(
		int(enemies.kills), int(director.waves_started), int(towers.built), nests_cleared,
		nests_total, int(town.town_tier), run_mode != null and run_mode.is_tower_defense(),
		vehicle.hp > 0.0, has_relic, claimed_planets.size() > 0, boss_killed)
	if not newly.is_empty():
		print("[godot] 新成就 %d 个：%s" % [newly.size(), ",".join(newly)])

# =========================================================
#  阶段 11 收尾：把剩下的面板补齐（设置 / 背包详情 / 图鉴 / 手柄提示）
# =========================================================

## 设置页签：音量 / 显示 / 玩法 / 语言，改完即时生效并写盘
func _fill_settings(body: Node) -> void:
	var head := Label.new()
	head.text = "设置（即时生效，写进 user://settings.json）"
	head.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(head)
	for pair in [["masterVolume", "主音量"], ["musicVolume", "音乐"], ["sfxVolume", "音效"]]:
		body.add_child(_slider_row(String(pair[0]), String(pair[1]), 0.0, 1.0, 0.05))
	for pair in [["quality", "画质"], ["uiScale", "界面缩放"], ["autoSaveMinutes", "自动存档（分钟）"]]:
		var lo := 0.0
		var hi := 2.0
		var step := 1.0
		if String(pair[0]) == "uiScale":
			lo = 0.8
			hi = 1.4
			step = 0.05
		elif String(pair[0]) == "autoSaveMinutes":
			lo = 1.0
			hi = 30.0
			step = 1.0
		body.add_child(_slider_row(String(pair[0]), String(pair[1]), lo, hi, step))
	for pair in [["fullscreen", "全屏"], ["showFps", "显示帧率"], ["showMinimap", "显示小地图"],
		["showGamepadHint", "显示手柄提示"]]:
		var cb := CheckBox.new()
		var key := String(pair[0])
		cb.text = String(pair[1])
		cb.button_pressed = GdMath.truthy(settings.get_value(key))
		cb.toggled.connect(func(on: bool) -> void:
			settings.set_value(key, on)
			settings.apply(get_tree(), key == "fullscreen")
			settings.save()
			_refresh_panel())
		body.add_child(cb)
	var lrow := HBoxContainer.new()
	var ll := Label.new()
	ll.text = "语言"
	ll.custom_minimum_size = Vector2(120, 0)
	lrow.add_child(ll)
	for lang in Settings.LANGS:
		var b := Button.new()
		b.text = "中文" if String(lang) == "zh" else "English"
		b.disabled = String(settings.get_value("language")) == String(lang)
		var lg := String(lang)
		b.pressed.connect(func() -> void:
			settings.set_value("language", lg)
			settings.save()
			_refresh_panel())
		lrow.add_child(b)
	body.add_child(lrow)
	var rrow := HBoxContainer.new()
	var reset := Button.new()
	reset.text = "恢复默认"
	reset.pressed.connect(func() -> void:
		for k in Settings.DEFAULTS.keys():
			settings.set_value(String(k), Settings.DEFAULTS[k])
		settings.apply(get_tree(), true)
		settings.save()
		_refresh_panel())
	rrow.add_child(reset)
	body.add_child(rrow)


func _slider_row(key: String, label: String, lo: float, hi: float, step: float) -> HBoxContainer:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size = Vector2(140, 0)
	var slider := HSlider.new()
	slider.min_value = lo
	slider.max_value = hi
	slider.step = step
	slider.value = float(settings.get_value(key))
	slider.custom_minimum_size = Vector2(240, 0)
	var val := Label.new()
	val.text = "%.2f" % float(settings.get_value(key))
	val.custom_minimum_size = Vector2(60, 0)
	slider.value_changed.connect(func(v: float) -> void:
		settings.set_value(key, v)
		settings.apply(get_tree())
		settings.save()
		val.text = "%.2f" % float(settings.get_value(key)))
	row.add_child(l)
	row.add_child(slider)
	row.add_child(val)
	return row


## 背包/装备页签：装备槽 + 武器快捷栏 + 背包（可排序）+ 详情
var inv_sort := "rarity"
var inv_selected := ""
var inv_demo_bag: Array = []


func _fill_inventory_full(body: Node) -> void:
	# 装备槽（5 个：头盔/胸甲/护腿/饰品×2）
	var eh := Label.new()
	eh.text = "— 装备槽 —"
	eh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(eh)
	var slots := ["helmet", "chest", "legs", "trinket1", "trinket2"]
	var srow := HBoxContainer.new()
	for i in slots.size():
		var s := String(slots[i])
		var item: Dictionary = hotbar.equipment.get(s, {})
		var l := Label.new()
		l.text = "%s：%s" % [[ "头盔", "胸甲", "护腿", "饰品1", "饰品2" ][i],
			String(item.get("name", "（空）"))]
		l.add_theme_color_override("font_color",
			UiPanels.RARITY_COLOR.get(String(item.get("rarity", "common")), Color("#6b7684")) if not item.is_empty()
			else Color("#6b7684"))
		l.custom_minimum_size = Vector2(190, 0)
		srow.add_child(l)
	body.add_child(srow)

	# 武器快捷栏（4 格：数字键 1-4）
	var wh := Label.new()
	wh.text = "— 武器（数字键 1-4 切换，5 换弹）—"
	wh.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(wh)
	var wrow := HBoxContainer.new()
	for i in Hotbar.MAX_WEAPONS:
		var b := Button.new()
		if i < hotbar.weapons.size():
			var w: Dictionary = hotbar.weapons[i]
			b.text = "%d %s" % [i + 1, String(w.get("name", "?"))]
			b.add_theme_color_override("font_color",
				UiPanels.RARITY_COLOR.get(String(w.get("rarity", "common")), Color.WHITE))
			b.disabled = i == hotbar.weapon_index
		else:
			b.text = "%d （空）" % (i + 1)
			b.disabled = true
		var idx := i
		b.pressed.connect(func() -> void:
			hotbar.select(idx)
			_recompute_stats()
			_refresh_panel())
		wrow.add_child(b)
	body.add_child(wrow)

	# 背包 + 排序
	print("[godot] 装备页签：演示背包 %d 件 · 真背包 %d 件 · 武器 %d 把" % [inv_demo_bag.size(), hotbar.bag.size(), hotbar.weapons.size()])
	var bh := HBoxContainer.new()
	var bl := Label.new()
	bl.text = "— 背包 %d/%d —" % [inv_demo_bag.size(), hotbar.bag.size() + inv_demo_bag.size()]
	bl.add_theme_color_override("font_color", Color("#8ba0bb"))
	bh.add_child(bl)
	for m in UiPanels.SORTS:
		var mid := String(m["id"])
		var b2 := Button.new()
		b2.text = String(m["name"])
		b2.disabled = mid == inv_sort
		b2.pressed.connect(func() -> void:
			inv_sort = mid
			_refresh_panel())
		bh.add_child(b2)
	body.add_child(bh)
	var items: Array = inv_demo_bag.duplicate()
	for it in hotbar.bag:
		items.append(it)
	var sorted := UiPanels.sort_bag(items, inv_sort)
	print("[godot] 背包行数 %d · Content 子节点 %d · scroll 尺寸 %s" % [sorted.size(), body.get_child_count(), str(body.get_parent().size)])
	var detail_id := inv_selected
	for it in sorted.slice(0, 10):
		var row := HBoxContainer.new()
		var l2 := Label.new()
		l2.text = "%s（%s）" % [String(it.get("name", it.get("id", "?"))), Names.rarity(String(it.get("rarity", "")))]
		l2.custom_minimum_size = Vector2(220, 0)
		l2.add_theme_color_override("font_color",
			UiPanels.RARITY_COLOR.get(String(it.get("rarity", "common")), Color.WHITE))
		var s2 := Label.new()
		s2.text = "评分 %.0f · 负重 %.1f" % [TechTree.score_item(it), TechTree.item_weight(it)]
		s2.custom_minimum_size = Vector2(200, 0)
		var b3 := Button.new()
		b3.text = "详情"
		var id_c := String(it.get("id", ""))
		var item_c: Dictionary = it
		b3.pressed.connect(func() -> void:
			inv_selected = id_c
			_refresh_panel())
		row.add_child(l2)
		row.add_child(s2)
		row.add_child(b3)
		body.add_child(row)

	# 详情
	if detail_id != "":
		var found: Dictionary = {}
		for it in items:
			if String(it.get("id", "")) == detail_id:
				found = it
		if not found.is_empty():
			var dh := Label.new()
			dh.text = "— 详情 —"
			dh.add_theme_color_override("font_color", Color("#8ba0bb"))
			body.add_child(dh)
			var d1 := Label.new()
			d1.text = "%s · %s · 评分 %.0f · 负重 %.1f" % [String(found.get("name", "")),
				Names.rarity(String(found.get("rarity", ""))), TechTree.score_item(found),
				TechTree.item_weight(found)]
			d1.add_theme_color_override("font_color",
				UiPanels.RARITY_COLOR.get(String(found.get("rarity", "common")), Color.WHITE))
			body.add_child(d1)
			var stats: Dictionary = found.get("stats", {})
			for k in stats.keys():
				var d2 := Label.new()
				d2.text = "  %s %+.2f" % [String(k), float(stats[k])]
				body.add_child(d2)
			if found.get("def") != null:
				var def: Dictionary = found.get("def", {})
				var d3 := Label.new()
				d3.text = "  伤害 %.1f · 间隔 %.2fs · 射程 %.0f" % [
					DataLoader.num_or(def, "damage", 10.0), DataLoader.num_or(def, "cd", 0.5),
					DataLoader.num_or(def, "range", 300.0)]
				body.add_child(d3)


## 图鉴/帮助页签：把 help.json 的条目原样列出来
## 图鉴里的动作键名 → 中文（数据表里是 up/down/… 这种键名）
const KEY_LABELS := {
	"up": "向上移动（W / ↑）", "down": "向下移动（S / ↓）", "left": "向左移动（A / ←）",
	"right": "向右移动（D / →）", "sprint": "冲刺（Shift）", "dodge": "闪避翻滚（Space）",
	"vehicle": "上/下车 · 进虫巢 · 交互遗迹（F）", "interact": "采集 / 维修（E，按住）",
	"reload": "装填弹药（R）", "swapWeapon": "切换武器（Q）", "takeover": "接管炮塔（C）",
	"heal": "使用治疗（H）", "collect": "拾取（X）", "ping": "标记（Z）",
	"build": "建造（B）", "tech": "科技树（T）", "town": "城镇（G）",
	"experiments": "实验科技（V）", "inventory": "背包（Tab）", "map": "地图（M）",
	"pause": "暂停（Esc）", "screenshot": "截图（P）",
}


func _fill_codex(body: Node) -> void:
	var mod: Dictionary = DataLoader.new().module("help")
	var head := Label.new()
	head.text = "图鉴 · 操作与规则（数据来自 help.json）"
	head.add_theme_color_override("font_color", Color("#8ba0bb"))
	body.add_child(head)
	var loop: Array = mod.get("CORE_LOOP", [])
	if not loop.is_empty():
		var h2 := Label.new()
		h2.text = "— 核心循环 —"
		h2.add_theme_color_override("font_color", Color("#6ee7a8"))
		body.add_child(h2)
		for i in mini(4, loop.size()):
			var l := Label.new()
			l.text = "%d. %s" % [i + 1, String(loop[i])]
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l.custom_minimum_size = Vector2(700, 0)
			body.add_child(l)
	var acts: Dictionary = mod.get("ACTION_HELP", {})
	if not acts.is_empty():
		var h3 := Label.new()
		h3.text = "— 操作 —"
		h3.add_theme_color_override("font_color", Color("#6ee7a8"))
		body.add_child(h3)
		var shown := 0
		for k in acts.keys():
			if shown >= 8:
				break
			shown += 1
			var l2 := Label.new()
			l2.text = "%s：%s" % [String(KEY_LABELS.get(String(k), k)), String(acts[k])]
			l2.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l2.custom_minimum_size = Vector2(700, 0)
			body.add_child(l2)
	var rar: Array = mod.get("RARITY_HELP", [])
	if not rar.is_empty():
		var h4 := Label.new()
		h4.text = "— 品质 —"
		h4.add_theme_color_override("font_color", Color("#6ee7a8"))
		body.add_child(h4)
		for pair in rar:
			var l3 := Label.new()
			l3.text = "%s：%s" % [String(pair[0]), String(pair[1])]
			l3.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l3.custom_minimum_size = Vector2(700, 0)
			body.add_child(l3)
	var fail: Array = mod.get("FAILURE_ROWS", [])
	if not fail.is_empty():
		var h5 := Label.new()
		h5.text = "— 会怎么输 —"
		h5.add_theme_color_override("font_color", Color("#ff5f6d"))
		body.add_child(h5)
		for row in fail:
			var l4 := Label.new()
			l4.text = String(row)
			l4.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l4.custom_minimum_size = Vector2(700, 0)
			body.add_child(l4)


## 手柄提示：接上手柄时在行动栏上方显示一行手柄按键（数据来自 help.json 的 PAD_ROWS）
func _build_gamepad_hint() -> void:
	var mod: Dictionary = DataLoader.new().module("help")
	var rows: Array = mod.get("PAD_ROWS", [])
	if rows.is_empty():
		return
	var box := PanelContainer.new()
	box.name = "PadHint"
	box.position = Vector2(300, 636)
	box.custom_minimum_size = Vector2(680, 26)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.06, 0.08, 0.12, 0.72)
	style.border_color = Color(0.45, 0.55, 0.68, 0.5)
	style.set_border_width_all(1)
	style.set_corner_radius_all(5)
	box.add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_child(row)
	for i in mini(6, rows.size()):
		var pair: Array = rows[i]
		var l := Label.new()
		l.text = "[%s] %s" % [String(pair[0]), String(pair[1])]
		l.add_theme_font_size_override("font_size", 12)
		row.add_child(l)
	$UI.add_child(box)
	# 只有真的接上手柄才显示（没有手柄时这行只是噪音）
	box.visible = Input.get_connected_joypads().size() > 0
	pad_hint = box


var pad_hint: Control = null


## 演示用背包（只在 --tech 1 的截图/联调模式下填充）：内容全部取自真实数据表，
## 这样「装备」页签能展示品质着色、评分/负重、详情与排序的真实效果。
func _make_demo_bag() -> Array:
	var wdefs: Dictionary = DataLoader.new().table("weapons", "WEAPON_DEF", {})
	var edefs: Dictionary = DataLoader.new().table("weapons", "EQUIP_DEF", {})
	var rarities := ["common", "uncommon", "rare", "epic", "relic"]
	var out: Array = []
	var i := 0
	for id in wdefs.keys():
		if i >= 5:
			break
		var d: Dictionary = wdefs[id]
		out.append({ "id": String(id), "type": "weapon", "name": String(d.get("name", id)),
			"rarity": rarities[i % rarities.size()], "def": d })
		i += 1
	i = 0
	for id in edefs.keys():
		if i >= 5:
			break
		var d2: Dictionary = edefs[id]
		out.append({ "id": String(id), "type": "armor", "slot": String(d2.get("slot", "chest")),
			"name": String(d2.get("name", id)), "rarity": rarities[(i + 2) % rarities.size()],
			"def": d2, "stats": d2.get("stats", { "armor": 6.0 + float(i) * 4.0, "hpMax": 20.0 + float(i) * 10.0 }) })
		i += 1
	return out

## 每帧维修：站在打残的塔/建筑旁边按住 E 就修（金属按 0.28/点扣）
func _tick_repair(delta: float) -> void:
	if not Input.is_key_pressed(KEY_E) or paused:
		return
	var cands: Array = []
	for t in towers.towers:
		cands.append(t)
	for s in towers.structures:
		cands.append(s)
	for b in towers.bases:
		cands.append(b)
	var pick = Repair.nearest_repairable(cands, player.position.x, player.position.y, 76.0)
	if pick == null:
		return
	if Repair.repair_at(pick["target"], player_stats, props_layer.resources, delta):
		player.repair_flash = 1.0

## 顿帧：`add_hitstop(0.06)` 之类，期间世界推进乘一个很小的系数
func add_hitstop(seconds: float, scale: float = 0.15) -> void:
	if seconds <= 0.0:
		return
	hitstop = maxf(hitstop, seconds)
	hitstop_scale = minf(hitstop_scale, scale)


## 基地被毁的表现：屏幕震一下 + 弹一条提示（人口清空/追杀切换在系统层已经生效）
func _check_base_destroyed() -> void:
	if base_destroyed_shown or towers.bases.is_empty():
		return
	for b in towers.bases:
		if GdMath.truthy(b.get("destroyed", false)):
			base_destroyed_shown = true
			cam_rig.shake(18.0, 0.9)
			add_hitstop(0.35, 0.05)
			print("[godot] 核心舱被摧毁 —— 人口清零，吸引阵列停机，虫群转为追杀")

## 显示前置界面（世界还没生成，模拟也没跑）
func _show_front_end() -> void:
	front_end = FrontEnd.new()
	front_end.start_requested.connect(func(params: Dictionary) -> void:
		_start_run(params))
	front_end.quit_requested.connect(func() -> void:
		get_tree().quit())
	front_end.attach($UI)
	if auto_flow >= 0:
		front_end.goto(auto_flow)      # 截图/联调：直接跳到某一屏
	print("[godot] 前置界面就绪（世界尚未生成，模拟未启动）")

## 当前武器的**基础**射程（不含加成）——加成由 HUD 那边用 rangeMult 体现
func _weapon_base_range() -> float:
	if player == null or player.loadout == null:
		return 0.0
	return DataLoader.num_or(player.loadout.def, "range", 0.0)