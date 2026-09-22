## HUD —— 把「右上角一行调试文本」变成正经的常驻抬头显示。
##
## 拆成两层：
##   - `HudModel`（本文件的静态函数）：**纯计算**，把一局的状态翻成 HUD 该显示的字符串与比例，
##     可以在 headless 里逐条断言；
##   - `HudView`（`build()`）：用 Control 拼出来，数据全部来自 `HudModel`。
##
## 为什么要拆：HUD 里真正会出错的是「显示什么」，不是「画在哪」。
## 比如波次倒计时该不该显示、Boss 血条什么时候出现、血条比例怎么算 ——
## 这些放在纯函数里就能测；而 `Label.text = ...` 只能靠眼睛。
class_name HudModel

## 血条比例（0~1），并给出颜色：低血变红
static func hp_fraction(hp: float, hp_max: float) -> float:
	return GdMath.clampf01(hp / maxf(1.0, hp_max))


static func hp_color(frac: float) -> Color:
	if frac > 0.6:
		return Color("#6ee7a8")
	if frac > 0.3:
		return Color("#ffba4c")
	return Color("#ff5f6d")


static func hp_text(hp: float, hp_max: float) -> String:
	return "%d / %d" % [int(ceilf(hp)), int(round(hp_max))]


## 弹药：换弹中显示进度而不是数字
static func ammo_text(ammo: int, ammo_max: int, reloading: bool, progress: float) -> String:
	if reloading:
		return "换弹 %d%%" % int(round(GdMath.clampf01(progress) * 100.0))
	return "%d / %d" % [ammo, ammo_max]


## 波次状态：平静期显示倒计时，预警期显示「即将抵达」，进行中显示剩余
## 有效射程读数（玩家反馈「射程提升好像不生效」——
## 机制是生效的，但界面上看不到变化，所以补一行明确的读数让升级看得见）。
static func range_text(base_range: float, range_mult: float) -> String:
	if base_range <= 0.0:
		return ""
	var cur := int(round(base_range * (1.0 + range_mult)))
	var pct := int(round(range_mult * 100.0))
	return "射程 %d（+%d%%）" % [cur, pct] if pct > 0 else "射程 %d" % cur


static func wave_text(state: int, timer: float, number: int, remaining: int, total: int,
	hunt_mode: bool) -> String:
	if hunt_mode:
		return "追杀中"
	match state:
		Director.State.CALM:
			if timer <= 40.0:
				return "第 %d 波 %d 秒后抵达" % [number + 1, int(ceilf(maxf(0.0, timer)))]
			return "平静 · 下一波 %d 秒" % int(ceilf(maxf(0.0, timer)))
		Director.State.INCOMING:
			return "第 %d 波即将抵达（%d 秒）" % [number, int(ceilf(maxf(0.0, timer)))]
		Director.State.ACTIVE:
			return "第 %d 波进行中 · 剩余 %d/%d" % [number, remaining, total]
		Director.State.HUNT:
			return "追杀中"
	return ""


static func wave_color(state: int, hunt_mode: bool) -> Color:
	if hunt_mode or state == Director.State.HUNT:
		return Color("#ff5f6d")
	if state == Director.State.ACTIVE:
		return Color("#ffba4c")
	if state == Director.State.INCOMING:
		return Color("#ff9a4c")
	return Color("#8ba0bb")


## 吸引阵列：燃料百分比 + 停机警告
static func beacon_text(fuel: float, fuel_max: float, online: bool, level: int) -> String:
	if not online:
		return "吸引阵列停机 · 补能"
	return "阵列 Lv.%d · 燃料 %d%%" % [level, int(round(GdMath.clampf01(fuel / maxf(1.0, fuel_max)) * 100.0))]


## Boss 血条：只有场上存在 Boss 时才显示（返回空串表示不画）
static func boss_bar_title(enemies: Array) -> String:
	for e in enemies:
		if GdMath.truthy(e.get("boss", false)) and not GdMath.truthy(e.get("dead", false)):
			return String((e.get("def", {}) as Dictionary).get("name", "巢穴主"))
	return ""


static func boss_bar_fraction(enemies: Array) -> float:
	for e in enemies:
		if GdMath.truthy(e.get("boss", false)) and not GdMath.truthy(e.get("dead", false)):
			return GdMath.clampf01(float(e["hp"]) / maxf(1.0, float(e.get("hpMax", 1.0))))
	return 0.0


## 资源行：只显示「有值」的资源，避免一排 0 占地方
static func resource_text(resources: Dictionary, order: Array = ["fiber", "metal", "crystal", "parts", "food", "water"]) -> String:
	var parts: Array = []
	for k in order:
		var v := int(resources.get(String(k), 0))
		if v > 0:
			parts.append("%s %d" % [Names.resource(String(k)), v])
	if parts.is_empty():
		return "（按 E 采集）"
	return " · ".join(parts)


## 载具状态行（没上车时不显示）
static func vehicle_text(mounted: bool, fuel: float, fuel_max: float, hp: float, hp_max: float) -> String:
	if not mounted:
		return ""
	return "载具 油 %d%% · 车体 %d%%" % [
		int(round(GdMath.clampf01(fuel / maxf(1.0, fuel_max)) * 100.0)),
		int(round(GdMath.clampf01(hp / maxf(1.0, hp_max)) * 100.0))]


## 副本里显示副本信息，地表显示群系/坐标
static func place_text(dungeon: Variant, biome_name: String, tx: int, ty: int, tier: int) -> String:
	if dungeon is Dictionary and not (dungeon as Dictionary).is_empty():
		var d: Dictionary = dungeon
		return "虫巢 T%d · 入口 (%d,%d) · 巢穴主 (%d,%d)" % [
			int(d["tier"]), int(d["entry"]["tx"]), int(d["entry"]["ty"]),
			int(d["boss"]["tx"]), int(d["boss"]["ty"])]
	return "%s (%d,%d) · %d 层" % [biome_name, tx, ty, tier]
