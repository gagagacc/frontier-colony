## 模式系统（开拓 / 纯塔防）—— `src/data/modes.js` + runState 里各处分支的移植。
##
## 两个模式的差别**全在数据里**（`modes.json` 的 MODE_DEF），代码只读这些开关：
##   - `hasPlayer`：塔防模式没有角色操控（也没有载具与大世界采集）；
##   - `world.nestScale / poiScale / compact`：塔防模式不撒巢穴与地标，地图更紧凑；
##   - `wave.source = 'director'`：怪潮不看巢穴，按波次从阵地外涌来；
##   - `startResources`：开局的启动资金；
##   - `fieldRadius`：**阵地半径** —— 塔防模式里「能建多远」就是阵地有多大；
##   - `endCondition = baseDestroyed`：基地没了就结束。
##
## 还有两条**跨文件的例外**（JS 写在 runState 里，这里同样集中在一处）：
##   1. 塔防模式的 `hasFeature('autoCollect')` **恒为真** —— 没有角色去捡东西，
##      不给的话整场拿不到任何材料；
##   - 塔防模式的建造半径 = `fieldRadius`（不是「基地 + 一段延伸」）。
class_name RunMode

const DEFAULT_ID := "frontier"

var _defs: Dictionary = {}
var _current := DEFAULT_ID


func _init(mode_id: String = DEFAULT_ID) -> void:
	var mod: Dictionary = DataLoader.new().module("modes")
	_defs = mod.get("MODE_DEF", {})
	set_mode(mode_id)


func set_mode(mode_id: String) -> bool:
	if not _defs.has(mode_id):
		return false
	_current = mode_id
	return true


func id() -> String:
	return _current


func def() -> Dictionary:
	return _defs.get(_current, {})


func is_tower_defense() -> bool:
	return _current == "towerDefense"


func has_player() -> bool:
	return GdMath.truthy(def().get("hasPlayer", true))


func field_radius() -> float:
	# num() 而不是 num_or()：这个文件里「0」都是合法取值，只有「键缺失」才该兜底
	return DataLoader.num(def(), "fieldRadius", 900.0)


func warn_seconds() -> float:
	return DataLoader.num_or(def().get("wave", {}), "warnSeconds", 22.0)


func prep_seconds() -> float:
	return DataLoader.num_or(def().get("wave", {}), "prepSeconds", 0.0)


func start_resources() -> Dictionary:
	return def().get("startResources", {})


func end_condition() -> String:
	return DataLoader.str_of(def(), "endCondition", "")


## 世界生成参数（巢穴/地标密度、是否紧凑）
func world_opts() -> Dictionary:
	var w: Dictionary = def().get("world", {})
	return {
		# num() 而不是 num_or()：塔防模式的 nestScale 就是 0（不撒巢穴）`n		"nestScale": DataLoader.num(w, "nestScale", 1.0),
		"poiScale": DataLoader.num(w, "poiScale", 1.0),
		"compact": GdMath.truthy(w.get("compact", false)),
		"landingSites": DataLoader.int_of(w, "landingSites", 3),
	}


## 建造半径：塔防模式 = 整片阵地；开拓模式 = 基地 + 一段延伸
func build_radius_from(base_radius: float = 520.0) -> float:
	return field_radius() if is_tower_defense() else base_radius


## 某功能是否可用。塔防模式白送「自动收集」（没有角色去捡东西）
func has_feature(feature: String, unlocks: Dictionary) -> bool:
	if is_tower_defense() and feature == "autoCollect":
		return true
	return (unlocks.get("features", []) as Array).has(feature)


## 波次间隔（塔防模式没有巢穴可清：只随波次与阵列等级收紧）
func next_interval(base_interval: float, wave_number: int, nests_alive: int, nests_total: int,
	interval_min: float) -> float:
	if is_tower_defense():
		var shrink := minf(0.45, float(wave_number) * 0.02)
		return GdMath.clampv(base_interval * (1.0 - shrink), interval_min, base_interval)
	var nest_factor := GdMath.clampf01(float(nests_alive) / maxf(1.0, float(nests_total)))
	return GdMath.clampv(base_interval * (0.6 + nest_factor * 0.55), interval_min, base_interval * 1.4)


## 模式列表（给 UI 选择界面用）
func list_modes() -> Array:
	var mod: Dictionary = DataLoader.new().module("modes")
	var ids: Array = mod.get("MODE_LIST", [])
	var out: Array = []
	for id in ids:
		if _defs.has(String(id)):
			out.append(_defs[String(id)])
	return out
