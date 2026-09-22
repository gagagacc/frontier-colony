## 副本进出（阶段 9 的接线）。
##
## 与 JS 版同构：**副本是另一个 World 对象**，地表那份原封不动地留着，
## 出来时切回去即可。这样：
##   - 地表上的塔、城镇、巢穴进度都不会被副本污染；
##   - 也不需要「出副本时重新生成地表」那 5 秒。
##
## 用法（在 Game 里）：
##   var b := DungeonFlow.new()
##   b.enter(game, tier)   /   b.exit(game)
class_name DungeonFlow

var surface_world: GdWorld = null
var dungeon_world: GdWorld = null
var active := false
var surface_player_pos := Vector2.ZERO
var tier := 1
var enter_ms := 0


## 进副本：新建一个世界并挖成虫巢，然后把所有系统切过去
func enter(game, p_tier: int) -> bool:
	if active:
		return false
	tier = clampi(p_tier, 1, 10)
	var t0 := Time.get_ticks_msec()
	dungeon_world = GdWorld.new("%s:nest:%d" % [game.world.seed, tier], {})
	Dungeon.carve(dungeon_world, tier)
	enter_ms = Time.get_ticks_msec() - t0

	surface_world = game.world
	surface_player_pos = game.player.position
	_retarget(game, dungeon_world)
	game.player.position = Vector2(
		float(dungeon_world.dungeon["playerStart"]["x"]),
		float(dungeon_world.dungeon["playerStart"]["y"]))
	# 副本里没有地表那些怪 / 塔（JS 版也是另一套 RunState）
	game.enemies.enemies.clear()
	game.projectiles.projectiles.clear()
	game.towers.towers.clear()
	game.towers.structures.clear()
	game.director.world = dungeon_world
	game.director.state = Director.State.CALM
	game.director.timer = 9999.0          # 副本里不跑怪潮
	# 副本内容：一只巢穴主 + 固定数量守军（与 JS 的 _setupDungeon 同构）
	var boss: Dictionary = game.enemies.spawn_dungeon_boss(tier,
		float(dungeon_world.dungeon["boss"]["x"]), float(dungeon_world.dungeon["boss"]["y"]))
	var guard: int = game.enemies.spawn_dungeon_garrison(tier)
	if not boss.is_empty():
		var kinds: Array = []
		for ab in boss["abilities"]:
			kinds.append(String(ab["kind"]))
		print("[godot] 巢穴主就位：%s（hp %d，技能 %s）" % [
			String(boss["def"].get("name", "?")), int(boss["hp"]), ",".join(kinds)])
	print("[godot] 副本守军 %d 只" % guard)
	active = true
	# 相机直接怼到新位置（不然会从地表「飞」过整张地图）
	game.camera.position = game.player.position
	game.camera.reset_smoothing()
	print("[godot] 进入虫巢副本 T%d · %d ms · 入口 (%d,%d) · Boss (%d,%d) · 侧室 %d" % [
		tier, enter_ms,
		int(dungeon_world.dungeon["entry"]["tx"]), int(dungeon_world.dungeon["entry"]["ty"]),
		int(dungeon_world.dungeon["boss"]["tx"]), int(dungeon_world.dungeon["boss"]["ty"]),
		(dungeon_world.dungeon["chambers"] as Array).size()])
	return true


## 出副本：切回地表那份世界，玩家回到原处
func exit(game) -> bool:
	if not active or surface_world == null:
		return false
	_retarget(game, surface_world)
	game.player.position = surface_player_pos
	game.camera.position = surface_player_pos
	game.camera.reset_smoothing()
	game.enemies.enemies.clear()
	game.projectiles.projectiles.clear()
	game.director.world = surface_world
	game.director.timer = 30.0
	active = false
	print("[godot] 撤出虫巢副本 —— 回到地表")
	return true


## 把各系统指向新的世界对象
func _retarget(game, w: GdWorld) -> void:
	game.world = w
	game.terrain.setup(w, game.atlas, game.camera)
	game.player.world = w
	game.projectiles.world = w
	game.enemies.world = w
	game.towers.world = w
	game.minimap.setup(w, game.atlas, game.player)
	if w.dungeon == null:
		# 回地表：按基地重建建造范围（副本里建造范围是被清掉的）
		game.towers.bases = [{
			"x": float(w.base_site["x"]), "y": float(w.base_site["y"]), "r": 96.0,
			"destroyed": false, "buildRadius": 520.0,
		}]
	else:
		game.towers.bases = []


## 玩家是不是站在副本入口旁（用来显示「按 F 撤退」）
func near_entry(game) -> bool:
	if not active or dungeon_world == null:
		return false
	var e: Dictionary = dungeon_world.dungeon["entry"]
	return GdMath.dist(game.player.position.x, game.player.position.y,
		float(e["x"]), float(e["y"])) < 150.0
