## Steam 成就桥 —— `src/core/steamClient.js` 的移植。
##
## JS 版的做法：`window.frontier.steam` 由 Electron 主进程提供，**拿不到就降级**
## （浏览器里玩、Steam 没启动、没登录 —— 都只是「成就不上报」，游戏照常能玩）。
## Godot 这边结构完全一样，只是把桥换成 GodotSteam：
##
##   1. 装了 GodotSteam（GDExtension 或带模块的编辑器）→ `Steam` 单例存在 → 真正上报；
##   2. 没装 / 没开 Steam / 没登录 → **静默降级**：成就仍记在本地存档里，
##      游戏一点都不受影响，只在日志里说一次「未接入 Steam」。
##
## 为什么坚持这样：成就系统最容易写出「看起来能用、实际不上报」的壳。
## 这里的规矩是 —— **要么真上报，要么明确返回 false 并说清楚为什么**。
class_name SteamBridge

const LOCAL_KEY := "achievements"     # 存在 user://save_meta.json 里

## 成就目录（与 JS 的 ACHIEVEMENT_INFO 一一对应，API 名必须与 Steamworks 后台一致）
const ACHIEVEMENTS := {
	"ACH_FIRST_LANDING": { "name": "脚踏实地", "desc": "第一次降落到异星地表", "icon": "🜨" },
	"ACH_FIRST_WAVE": { "name": "守住了", "desc": "第一次击退虫潮", "icon": "🛡" },
	"ACH_FIRST_TOWER": { "name": "空投成功", "desc": "第一次空投防御塔", "icon": "▣" },
	"ACH_FIRST_VEHICLE": { "name": "有车了", "desc": "申请到第一台载具", "icon": "⛟" },
	"ACH_FIRST_RED": { "name": "一抹猩红", "desc": "获得第一件红色装备", "icon": "✦" },
	"ACH_NEST_CLEAR": { "name": "捣毁巢穴", "desc": "清剿第一个虫巢", "icon": "☠" },
	"ACH_DUNGEON_BOSS": { "name": "深入巢穴", "desc": "击杀巢穴主", "icon": "💀" },
	"ACH_PLANET_CLAIMED": { "name": "这颗星球归我了", "desc": "占领一颗星球", "icon": "★" },
	"ACH_TEN_WAVES": { "name": "十波不倒", "desc": "单一殖民地击退 10 波虫潮", "icon": "⚔" },
	"ACH_TOWN_CITY": { "name": "拓荒城市", "desc": "城镇发展到「拓荒城市」", "icon": "⌂" },
	"ACH_TD_MODE": { "name": "钢铁防线", "desc": "在纯塔防模式击退 10 波", "icon": "⛨" },
	"ACH_ALL_NESTS": { "name": "星球净化", "desc": "清光整颗星球的虫巢", "icon": "✧" },
}

var available := false          # 是否真的接上了 Steam
var player_name := ""
var unlocked: Dictionary = {}   # id -> true（本地也记，离线时仍能看到自己拿过什么）
var stats: Dictionary = {}      # 需要同步给 Steam 的统计量
var _logged := false


func _init() -> void:
	load_local()


## 是否装了 GodotSteam（GDExtension 单例 或 带模块的编辑器都算）
static func steam_present() -> bool:
	if Engine.has_singleton("Steam"):
		return true
	# 带模块编译的编辑器里，Steam 是一个全局类
	return ClassDB.class_exists("Steam")


## 启动时问一次。返回是否真的接上（没接上不影响游戏）
func init_steam(app_id: int = 480) -> bool:
	if not steam_present():
		if not _logged:
			print("[godot] 未接入 Steam（没装 GodotSteam）—— 成就只记在本地，游戏照常玩")
			_logged = true
		available = false
		return false
	var steam: Variant = Engine.get_singleton("Steam") if Engine.has_singleton("Steam") else null
	if steam == null:
		available = false
		return false
	var res: Variant = steam.steamInitEx(app_id, true)
	var ok := false
	if res is Dictionary:
		ok = int(res.get("status", 1)) == 0
	elif res is int:
		ok = int(res) == 0
	available = ok
	if ok:
		player_name = String(steam.getPersonaName()) if steam.has_method("getPersonaName") else ""
		print("[godot] Steam 已接入：%s（AppID %d）" % [player_name, app_id])
	else:
		if not _logged:
			print("[godot] Steam 未登录或未启动 —— 成就只记在本地")
			_logged = true
	return ok


## 解锁一个成就。**真上报返回 true；降级时返回 false 但仍然记到本地。**
func unlock(id: String) -> bool:
	if unlocked.has(id):
		return false
	unlocked[id] = true
	save_local()
	var info: Dictionary = ACHIEVEMENTS.get(id, {})
	print("[godot] 成就：%s（%s）%s" % [String(info.get("name", id)), id,
		"→ 已上报 Steam" if available else "→ 仅本地"])
	if not available:
		return false
	var steam: Variant = Engine.get_singleton("Steam") if Engine.has_singleton("Steam") else null
	if steam == null:
		return false
	steam.setAchievement(id)
	steam.storeStats()
	return true


func has(id: String) -> bool:
	return unlocked.has(id)


func count() -> int:
	return unlocked.size()


## 统计量：本地永远记，接上 Steam 时一并同步
func set_stat(name: String, value: float) -> void:
	stats[name] = value
	save_local()
	if not available:
		return
	var steam: Variant = Engine.get_singleton("Steam") if Engine.has_singleton("Steam") else null
	if steam == null:
		return
	if value == floorf(value):
		steam.setStatInt(name, int(value))
	else:
		steam.setStatFloat(name, value)
	steam.storeStats()


## 由统计量推导成就（与 JS 的 checkAchievements 同义：都是「到点就解锁」）
func check_from_state(kills: int, waves_survived: int, towers_built: int, nests_cleared: int,
	total_nests: int, town_tier: int, is_tower_defense: bool, has_vehicle: bool,
	has_relic: bool, planet_claimed: bool, boss_killed: bool) -> Array:
	var newly: Array = []
	var try_unlock := func(id: String, cond: bool) -> void:
		if cond and not unlocked.has(id):
			unlock(id)
			newly.append(id)
	try_unlock.call("ACH_FIRST_LANDING", true)
	try_unlock.call("ACH_FIRST_WAVE", waves_survived >= 1)
	try_unlock.call("ACH_FIRST_TOWER", towers_built >= 1)
	try_unlock.call("ACH_FIRST_VEHICLE", has_vehicle)
	try_unlock.call("ACH_FIRST_RED", has_relic)
	try_unlock.call("ACH_NEST_CLEAR", nests_cleared >= 1)
	try_unlock.call("ACH_DUNGEON_BOSS", boss_killed)
	try_unlock.call("ACH_PLANET_CLAIMED", planet_claimed)
	try_unlock.call("ACH_TEN_WAVES", waves_survived >= 10)
	try_unlock.call("ACH_TOWN_CITY", town_tier >= 3)
	try_unlock.call("ACH_TD_MODE", is_tower_defense and waves_survived >= 10)
	try_unlock.call("ACH_ALL_NESTS", total_nests > 0 and nests_cleared >= total_nests)
	return newly


# =========================================================
#  本地存档（离线也记得住）
# =========================================================

const META_PATH := "user://save_meta.json"


func save_local() -> void:
	var d: Dictionary = {}
	if FileAccess.file_exists(META_PATH):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(META_PATH))
		if parsed is Dictionary:
			d = parsed
	d[LOCAL_KEY] = unlocked.keys()
	d["stats"] = stats
	var f := FileAccess.open(META_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d, "  "))
		f.close()


func load_local() -> void:
	if not FileAccess.file_exists(META_PATH):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(META_PATH))
	if not (parsed is Dictionary):
		return
	var d: Dictionary = parsed
	unlocked.clear()
	for id in d.get(LOCAL_KEY, []):
		unlocked[String(id)] = true
	var st = d.get("stats", {})
	if st is Dictionary:
		stats = st
