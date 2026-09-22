## 防御塔数值与放置规则 —— `runState.createTower` + `towers.findPlacement` 的移植。
##
## 放置规则是玩家明确要求过的那一条（原话「我给防御塔基座加条件让他可以取消掉
## 防御塔的间隔」）：
##   - 塔放**空地**上：彼此圆心距离必须 ≥ TOWER_GAP(44px)；
##   - 塔放**【防御塔基座】**上：免间隔，可以一座挨一座；
##   - 基座自己不算建筑冲突（塔就是要坐在它上面）—— 这条以前漏了，导致
##     「塔永远放不到基座上」，基座沦为一块更贵的空地。
class_name TowerMath

const TOWER_GAP := 44.0        # 空地放塔的最小圆心距离
const PLATFORM_R := 26.0       # 「站在基座上」的判定半径
const CANDIDATE_STEPS := [
	Vector2(0, 0), Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1),
	Vector2(1, 1), Vector2(-1, -1), Vector2(1, -1), Vector2(-1, 1),
	Vector2(2, 0), Vector2(-2, 0), Vector2(0, 2), Vector2(0, -2),
]


## 与 JS scaleCost 同式：每项向上取整，且不小于 0
static func scale_cost(cost: Dictionary, mult: float = 1.0) -> Dictionary:
	var out: Dictionary = {}
	for k in cost.keys():
		out[k] = maxf(0.0, ceil(float(cost[k]) * mult))
	return out


static func tower_hp(def: Dictionary, stats: StatSet) -> float:
	return DataLoader.num_or(def, "hp", 200.0) * (1.0 + stats.stat("structureHpMult"))


static func tower_range(def: Dictionary, stats: StatSet) -> float:
	return DataLoader.num_or(def, "range", 200.0) * (1.0 + stats.stat("towerRange"))


static func tower_damage(def: Dictionary, stats: StatSet, level: int = 1) -> float:
	return DataLoader.num_or(def, "dmg", 10.0) * (1.0 + stats.stat("towerDamage")) * (1.0 + float(level - 1) * 0.25)


static func tower_cooldown(def: Dictionary, stats: StatSet) -> float:
	return DataLoader.num_or(def, "cd", 1.0) / (1.0 + stats.stat("towerAttackSpeed"))


static func tower_cap(stats: StatSet) -> int:
	return int(round(4.0 + stats.stat("towerCap")))


## 这个位置是不是站在某块【防御塔基座】上（是就返回那块基座，否则 null）
static func platform_at(structures: Array, x: float, y: float):
	for s in structures:
		if String(s.get("type", "")) != "turretSlot":
			continue
		if float(s.get("hp", 1.0)) <= 0.0:
			continue
		if GdMath.dist2(x, y, float(s["x"]), float(s["y"])) <= PLATFORM_R * PLATFORM_R:
			return s
	return null


## 找一个合法的建造点。
##
## `ctx` 需要提供：
##   world        GdWorld（用它判 is_blocked_px / build_radius_from）
##   towers       Array（已有塔）
##   structures   Array（已有建筑）
##   bases        Array（基地，要求 { x, y, r, destroyed, buildRadius }）
##   for_tower    bool：这次是放塔还是放建筑（只有塔吃「塔与塔的间隔」）
## 返回 { x, y, onPlatform } 或 null
static func find_placement(world: GdWorld, x: float, y: float, ctx: Dictionary) -> Variant:
	var for_tower := GdMath.truthy(ctx.get("for_tower", true))
	var towers: Array = ctx.get("towers", [])
	var structures: Array = ctx.get("structures", [])
	var bases: Array = ctx.get("bases", [])
	for step in CANDIDATE_STEPS:
		var tx := int(floor((x + step.x * Cfg.TILE) / Cfg.TILE))
		var ty := int(floor((y + step.y * Cfg.TILE) / Cfg.TILE))
		var px := float(tx * Cfg.TILE) + Cfg.TILE / 2.0
		var py := float(ty * Cfg.TILE) + Cfg.TILE / 2.0
		if world.is_blocked_px(px, py):
			continue
		var on_platform := platform_at(structures, px, py) != null
		var clash := false
		# 「塔与塔要留间隔」只约束塔，且只约束空地
		if for_tower and not on_platform:
			for t in towers:
				if GdMath.dist2(px, py, float(t["x"]), float(t["y"])) < TOWER_GAP * TOWER_GAP:
					clash = true
					break
		if not clash:
			for s in structures:
				if String(s.get("type", "")) == "turretSlot":
					continue                     # 基座不算冲突：塔要坐上去
				if float(s.get("hp", 1.0)) <= 0.0:
					continue
				if GdMath.dist2(px, py, float(s["x"]), float(s["y"])) < 40.0 * 40.0:
					clash = true
					break
		if not clash:
			for b in bases:
				if GdMath.truthy(b.get("destroyed", false)):
					continue
				var br := float(b.get("r", 96.0)) * 0.6
				if GdMath.dist2(px, py, float(b["x"]), float(b["y"])) < br * br:
					clash = true
					break
		if clash:
			continue
		var near_base := false
		for b in bases:
			if GdMath.truthy(b.get("destroyed", false)):
				continue
			var radius := float(b.get("buildRadius", 520.0))
			if GdMath.dist(px, py, float(b["x"]), float(b["y"])) < radius:
				near_base = true
				break
		if not near_base:
			continue
		return { "x": px, "y": py, "onPlatform": on_platform }
	return null
